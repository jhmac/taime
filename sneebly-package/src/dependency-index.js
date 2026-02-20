'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_FILE = 'dependency-index.json';

function buildDependencyIndex(projectRoot) {
  const index = {
    routes: {},
    services: {},
    pages: {},
    components: {},
    schema: [],
    buildTime: new Date().toISOString(),
  };

  const routeDir = path.join(projectRoot, 'server', 'routes');
  if (fs.existsSync(routeDir)) {
    const files = fs.readdirSync(routeDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const filePath = `server/routes/${file}`;
      const fullPath = path.join(projectRoot, filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const imports = _extractImports(content);
        const endpoints = _extractEndpoints(content);
        const routeName = file.replace(/\.(ts|js)$/, '');

        index.routes[routeName] = {
          file: filePath,
          imports: imports.map(i => _resolveImportPath(filePath, i, projectRoot)),
          endpoints,
          size: content.length,
        };
      } catch {}
    }
  }

  const serviceDir = path.join(projectRoot, 'server', 'services');
  if (fs.existsSync(serviceDir)) {
    const files = fs.readdirSync(serviceDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const filePath = `server/services/${file}`;
      const fullPath = path.join(projectRoot, filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const imports = _extractImports(content);
        const exports = _extractExports(content);
        const serviceName = file.replace(/\.(ts|js)$/, '');

        index.services[serviceName] = {
          file: filePath,
          imports: imports.map(i => _resolveImportPath(filePath, i, projectRoot)),
          exports,
          size: content.length,
          envVars: _extractEnvVars(content),
        };
      } catch {}
    }
  }

  const pagesDir = path.join(projectRoot, 'client', 'src', 'pages');
  if (fs.existsSync(pagesDir)) {
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
    for (const file of files) {
      const filePath = `client/src/pages/${file}`;
      const fullPath = path.join(projectRoot, filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const apiCalls = _extractApiCalls(content);
        const pageName = file.replace(/\.(tsx|ts)$/, '');

        index.pages[pageName] = {
          file: filePath,
          apiCalls,
          size: content.length,
        };
      } catch {}
    }
  }

  const schemaPath = path.join(projectRoot, 'shared', 'schema.ts');
  if (fs.existsSync(schemaPath)) {
    try {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      const tables = _extractTables(content);
      index.schema = tables;
    } catch {}
  }

  return index;
}

function _extractImports(content) {
  const imports = [];
  const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const imp = match[1];
    if (imp.startsWith('.') || imp.startsWith('@')) {
      imports.push(imp);
    }
  }
  return imports;
}

function _extractExports(content) {
  const exports = [];
  const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  return exports;
}

function _extractEndpoints(content) {
  const endpoints = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    endpoints.push({ method: match[1].toUpperCase(), path: match[2] });
  }
  return endpoints;
}

function _extractApiCalls(content) {
  const calls = [];
  const fetchRegex = /(?:queryKey|fetch|apiRequest)\s*[\(:].*?['"`](\/api\/[^'"`]+)['"`]/g;
  let match;
  while ((match = fetchRegex.exec(content)) !== null) {
    calls.push(match[1]);
  }
  return [...new Set(calls)];
}

function _extractTables(content) {
  const tables = [];
  const tableRegex = /export\s+const\s+(\w+)\s*=\s*pgTable\s*\(\s*['"`](\w+)['"`]/g;
  let match;
  while ((match = tableRegex.exec(content)) !== null) {
    tables.push({ variable: match[1], tableName: match[2] });
  }
  return tables;
}

function _extractEnvVars(content) {
  const vars = [];
  const envRegex = /process\.env\.(\w+)/g;
  let match;
  while ((match = envRegex.exec(content)) !== null) {
    if (!match[1].startsWith('NODE_') && match[1] !== 'PORT') {
      vars.push(match[1]);
    }
  }
  return [...new Set(vars)];
}

function _resolveImportPath(fromFile, importPath, projectRoot) {
  if (importPath.startsWith('@shared/')) {
    return 'shared/' + importPath.replace('@shared/', '');
  }
  if (importPath.startsWith('@/')) {
    return 'client/src/' + importPath.replace('@/', '');
  }
  if (importPath.startsWith('.')) {
    const fromDir = path.dirname(fromFile);
    let resolved = path.join(fromDir, importPath);
    resolved = resolved.replace(/\\/g, '/');
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '']) {
      const full = path.join(projectRoot, resolved + ext);
      if (fs.existsSync(full)) return resolved + ext;
    }
    return resolved;
  }
  return importPath;
}

function getFilesForEndpoint(index, endpointPath) {
  const files = new Set();

  for (const [name, route] of Object.entries(index.routes)) {
    const hasEndpoint = route.endpoints.some(e => endpointPath.includes(e.path) || e.path.includes(endpointPath));
    if (hasEndpoint) {
      files.add(route.file);
      for (const imp of route.imports) {
        if (typeof imp === 'string' && !imp.includes('node_modules')) {
          files.add(imp);
        }
      }
    }
  }

  for (const [name, page] of Object.entries(index.pages)) {
    if (page.apiCalls.some(call => endpointPath.includes(call) || call.includes(endpointPath))) {
      files.add(page.file);
    }
  }

  if (files.size > 0) {
    files.add('shared/schema.ts');
  }

  return [...files];
}

function getFilesForIntegration(index, integrationName) {
  const files = new Set();
  const keywords = integrationName.toLowerCase();

  for (const [name, route] of Object.entries(index.routes)) {
    if (name.toLowerCase().includes(keywords)) {
      files.add(route.file);
      for (const imp of route.imports) {
        if (typeof imp === 'string' && !imp.includes('node_modules')) files.add(imp);
      }
    }
  }

  for (const [name, service] of Object.entries(index.services)) {
    if (name.toLowerCase().includes(keywords)) {
      files.add(service.file);
      for (const imp of service.imports) {
        if (typeof imp === 'string' && !imp.includes('node_modules')) files.add(imp);
      }
    }
  }

  for (const [name, page] of Object.entries(index.pages)) {
    if (name.toLowerCase().includes(keywords)) {
      files.add(page.file);
    }
  }

  if (files.size > 0) files.add('shared/schema.ts');

  return [...files];
}

function saveIndex(dataDir, index) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, INDEX_FILE), JSON.stringify(index, null, 2));
  } catch {}
}

function loadIndex(dataDir) {
  try {
    const filePath = path.join(dataDir, INDEX_FILE);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

module.exports = {
  buildDependencyIndex,
  getFilesForEndpoint,
  getFilesForIntegration,
  saveIndex,
  loadIndex,
};
