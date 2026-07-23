import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'server'];
const extensions = new Set(['.ts', '.tsx']);
const files = roots.flatMap((root) => walk(root)).filter((file) => extensions.has(path.extname(file)));
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (file.startsWith(`src${path.sep}`) && source.includes('fetch(') && file !== path.join('src', 'lib', 'api.ts') && !file.endsWith('.test.ts')) {
    failures.push(`${file}: direct frontend fetch() is only allowed in src/lib/api.ts`);
  }

  const normalized = file.split(path.sep).join('/');
  if (/['"]@earendil-works\//.test(source) && !normalized.startsWith('server/integrations/pi/')) {
    failures.push(`${file}: @earendil-works packages may only be referenced by server/integrations/pi`);
  }
  if (/server\/(features|integrations)\/.+Routes\.ts$/.test(normalized) && !file.endsWith('.test.ts')) {
    if (/from\s+['"](?:node:)?(?:fs|child_process)['"]/.test(source)) {
      failures.push(`${file}: route modules must delegate filesystem/process work to a service`);
    }
    if (/from\s+['"][^'"]*integrations\/pi\//.test(source) || /from\s+['"]@earendil-works\/pi/.test(source)) {
      failures.push(`${file}: route modules must not depend directly on Pi internals`);
    }
  }
  if (normalized.startsWith('server/platform/') && normalized !== 'server/platform/http/apiRouter.ts'
      && /from\s+['"][^'"]*(?:features|integrations)\//.test(source)) {
    failures.push(`${file}: platform modules must not depend on features or integrations`);
  }
  if (normalized.startsWith('server/features/') && !file.endsWith('.test.ts')
      && (/\b(?:ExtensionAPI|ExtensionFactory)\b/.test(source) || /\bpi\.(?:on|registerTool|registerCommand)\(/.test(source))) {
    failures.push(`${file}: Pi extension registration belongs in integrations/pi/extensions`);
  }
  if (/import\s+type[^;]+Repository\.ts['"]/.test(source)
      || /import\s*\{[^}]*\btype\s+(?:Project|ProjectDirectory|ProjectDirectoryInput|SessionBinding|SessionDirectoryBinding|SylphSettings|CommitMessageThinkingLevel)\b[^}]*\}\s*from\s*['"][^'"]*Repository\.ts['"]/.test(source)) {
    failures.push(`${file}: domain types must be imported from *Types.ts, not repositories`);
  }
  if (normalized.startsWith('server/') && !normalized.startsWith('server/index.') && !file.endsWith('.test.ts')
      && /^(?:fs\.)?(?:writeFileSync|mkdirSync)\(|^setInterval\(/m.test(source)) {
    failures.push(`${file}: import-time filesystem/timer side effects belong in the composition root`);
  }
}

const routeIndexPath = 'server/platform/http/apiRouter.ts';
const routeIndex = fs.readFileSync(routeIndexPath, 'utf8');
if (routeIndex.split('\n').length > 80 || /router\.(get|post|put|patch|delete)\(/.test(routeIndex)) {
  failures.push(`${routeIndexPath} must remain composition-only and under 80 lines`);
}

const runtimeFactoryPath = 'server/integrations/pi/runtime/runtimeFactory.ts';
const runtimeFactory = fs.readFileSync(runtimeFactoryPath, 'utf8');
if (runtimeFactory.split('\n').length > 120 || /from\s+['"](?:node:)?fs['"]/.test(runtimeFactory)) {
  failures.push(`${runtimeFactoryPath} must remain a thin Pi composition adapter (under 120 lines and no direct filesystem work)`);
}
const sessionResolverPath = 'server/integrations/pi/runtime/sessionResolver.ts';
const sessionResolver = fs.readFileSync(sessionResolverPath, 'utf8');
if (sessionResolver.split('\n').length > 100 || /from\s+['"](?:node:)?(?:fs|path)['"]/.test(sessionResolver)) {
  failures.push(`${sessionResolverPath} must remain thin orchestration (under 100 lines and no filesystem/path resolution)`);
}

const permissionFacadePath = 'server/features/permissions/permissionPolicy.ts';
if (fs.readFileSync(permissionFacadePath, 'utf8').split('\n').length > 100) {
  failures.push(`${permissionFacadePath} must remain a small facade over path and shell policy modules`);
}
const legacyUiBridge = 'server/integrations/pi/ui/uiBridge.ts';
if (fs.existsSync(legacyUiBridge)) {
  failures.push(`${legacyUiBridge}: UI request/status/artifact state must remain feature-owned; use extensionUiAdapter.ts for Pi translation`);
}

const flatSessionFiles = fs.readdirSync('server/features/sessions', { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name));
if (flatSessionFiles.length) {
  failures.push(`server/features/sessions must stay grouped by subdomain; move root files into lifecycle, workspace, worktrees, scratch, or runtime: ${flatSessionFiles.map((entry) => entry.name).join(', ')}`);
}

const graph = new Map(files.map((file) => [path.resolve(file), []]));
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const specs = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
  for (const spec of specs) {
    const base = path.resolve(path.dirname(file), spec);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    const target = candidates.find((candidate) => graph.has(path.resolve(candidate)));
    if (target) graph.get(path.resolve(file)).push(path.resolve(target));
  }
}

const visited = new Set(), active = new Set(), stack = [];
function visit(node) {
  visited.add(node); active.add(node); stack.push(node);
  for (const child of graph.get(node)) {
    if (!visited.has(child)) visit(child);
    else if (active.has(child)) failures.push(`import cycle: ${stack.slice(stack.indexOf(child)).map((file) => path.relative('.', file)).join(' -> ')} -> ${path.relative('.', child)}`);
  }
  stack.pop(); active.delete(node);
}
for (const node of graph.keys()) if (!visited.has(node)) visit(node);

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Architecture checks passed (${files.length} source files)`);
