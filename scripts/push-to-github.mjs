import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

let connectionSettings;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getClient() {
  const accessToken = await getAccessToken();
  return { octokit: new Octokit({ auth: accessToken }), token: accessToken };
}

function getAllFiles(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.endsWith('.tgz')) continue;
    if (entry.isDirectory()) {
      results.push(...getAllFiles(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

async function main() {
  const REPO_NAME = 'apppilot';
  const SOURCE_DIR = path.resolve('/home/runner/workspace/apppilot-package');
  const TAG = 'v0.3.0';

  console.log('Getting GitHub client...');
  const { octokit, token } = await getClient();

  const { data: user } = await octokit.users.getAuthenticated();
  const owner = user.login;
  console.log(`Authenticated as: ${owner}`);

  // 1. Create repo (or confirm it exists and has commits)
  let hasCommits = false;
  try {
    const { data: repo } = await octokit.repos.get({ owner, repo: REPO_NAME });
    console.log(`Repo ${owner}/${REPO_NAME} already exists`);
    try {
      await octokit.repos.listCommits({ owner, repo: REPO_NAME, per_page: 1 });
      hasCommits = true;
    } catch { hasCommits = false; }
  } catch (e) {
    if (e.status === 404) {
      console.log(`Creating private repo: ${REPO_NAME}...`);
      await octokit.repos.createForAuthenticatedUser({
        name: REPO_NAME,
        private: true,
        auto_init: true,
        description: 'AppPilot - Autonomous AI agent for app monitoring and improvement',
      });
      console.log('Repo created with initial commit');
      hasCommits = true;
      await new Promise(r => setTimeout(r, 2000));
    } else {
      throw e;
    }
  }

  if (!hasCommits) {
    console.log('Repo is empty, initializing with README...');
    await octokit.repos.createOrUpdateFileContents({
      owner, repo: REPO_NAME,
      path: 'README.md',
      message: 'Initialize repository',
      content: Buffer.from('# AppPilot\n').toString('base64'),
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Collect all files and create blobs
  const files = getAllFiles(SOURCE_DIR);
  console.log(`Found ${files.length} files to push`);

  const treeItems = [];
  for (const filePath of files) {
    const fullPath = path.join(SOURCE_DIR, filePath);
    const content = fs.readFileSync(fullPath);
    const isBinary = content.includes(0);

    let blobSha;
    if (isBinary) {
      const { data } = await octokit.git.createBlob({
        owner, repo: REPO_NAME,
        content: content.toString('base64'),
        encoding: 'base64',
      });
      blobSha = data.sha;
    } else {
      const { data } = await octokit.git.createBlob({
        owner, repo: REPO_NAME,
        content: content.toString('utf-8'),
        encoding: 'utf-8',
      });
      blobSha = data.sha;
    }

    treeItems.push({
      path: filePath,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    });
    process.stdout.write('.');
  }
  console.log('\nAll blobs created');

  // 3. Create tree
  const { data: tree } = await octokit.git.createTree({
    owner, repo: REPO_NAME,
    tree: treeItems,
  });
  console.log(`Tree created: ${tree.sha}`);

  // 4. Get parent commit and create new commit
  let parents = [];
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo: REPO_NAME, ref: 'heads/main' });
    parents = [ref.object.sha];
  } catch {}
  
  const { data: commit } = await octokit.git.createCommit({
    owner, repo: REPO_NAME,
    message: 'AppPilot v0.3.0 - Full source',
    tree: tree.sha,
    parents,
  });
  console.log(`Commit created: ${commit.sha}`);

  // 5. Set main branch ref
  try {
    await octokit.git.updateRef({
      owner, repo: REPO_NAME,
      ref: 'heads/main',
      sha: commit.sha,
      force: true,
    });
    console.log('Updated main branch');
  } catch {
    await octokit.git.createRef({
      owner, repo: REPO_NAME,
      ref: 'refs/heads/main',
      sha: commit.sha,
    });
    console.log('Created main branch');
  }

  // 6. Set default branch
  await octokit.repos.update({
    owner, repo: REPO_NAME,
    default_branch: 'main',
  });

  // 7. Create tag
  const { data: tagObj } = await octokit.git.createTag({
    owner, repo: REPO_NAME,
    tag: TAG,
    message: `Release ${TAG}`,
    object: commit.sha,
    type: 'commit',
  });

  await octokit.git.createRef({
    owner, repo: REPO_NAME,
    ref: `refs/tags/${TAG}`,
    sha: tagObj.sha,
  });
  console.log(`Tag ${TAG} created`);

  console.log(`\nDone! Repo: https://github.com/${owner}/${REPO_NAME}`);
  console.log(`Install with: npm install github:${owner}/${REPO_NAME}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
