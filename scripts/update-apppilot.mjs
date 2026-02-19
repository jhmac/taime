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
  if (!xReplitToken) throw new Error('X_REPLIT_TOKEN not found');
  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }
  ).then(res => res.json()).then(data => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  if (!accessToken) throw new Error('GitHub not connected');
  return accessToken;
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
  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'package.json'), 'utf-8'));
  const version = pkg.version;
  const tag = `v${version}`;
  const commitMsg = process.argv[2] || `Update AppPilot to ${tag}`;

  console.log(`Pushing AppPilot ${tag} to GitHub...`);

  const token = await getAccessToken();
  const octokit = new Octokit({ auth: token });
  const { data: user } = await octokit.users.getAuthenticated();
  const owner = user.login;
  console.log(`Authenticated as: ${owner}`);

  const files = getAllFiles(SOURCE_DIR);
  console.log(`Uploading ${files.length} files...`);

  const treeItems = [];
  for (const filePath of files) {
    const fullPath = path.join(SOURCE_DIR, filePath);
    const content = fs.readFileSync(fullPath);
    const isBinary = content.includes(0);
    const { data } = await octokit.git.createBlob({
      owner, repo: REPO_NAME,
      content: isBinary ? content.toString('base64') : content.toString('utf-8'),
      encoding: isBinary ? 'base64' : 'utf-8',
    });
    treeItems.push({ path: filePath, mode: '100644', type: 'blob', sha: data.sha });
    process.stdout.write('.');
  }
  console.log('\nBlobs created');

  const { data: tree } = await octokit.git.createTree({ owner, repo: REPO_NAME, tree: treeItems });

  let parents = [];
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo: REPO_NAME, ref: 'heads/main' });
    parents = [ref.object.sha];
  } catch {}

  const { data: commit } = await octokit.git.createCommit({
    owner, repo: REPO_NAME,
    message: commitMsg,
    tree: tree.sha,
    parents,
  });

  await octokit.git.updateRef({ owner, repo: REPO_NAME, ref: 'heads/main', sha: commit.sha, force: true });
  console.log(`Pushed commit: ${commit.sha.substring(0, 8)}`);

  try {
    const { data: tagObj } = await octokit.git.createTag({
      owner, repo: REPO_NAME, tag, message: `Release ${tag}`, object: commit.sha, type: 'commit',
    });
    await octokit.git.createRef({ owner, repo: REPO_NAME, ref: `refs/tags/${tag}`, sha: tagObj.sha });
    console.log(`Tagged: ${tag}`);
  } catch (e) {
    if (e.status === 422) {
      console.log(`Tag ${tag} already exists, skipping`);
    } else {
      throw e;
    }
  }

  console.log(`\nDone! Now run: npm update apppilot`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
