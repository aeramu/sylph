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
}

const routeIndex = fs.readFileSync('server/routes/index.ts', 'utf8');
if (routeIndex.split('\n').length > 80 || /router\.(get|post|put|patch|delete)\(/.test(routeIndex)) {
  failures.push('server/routes/index.ts must remain composition-only and under 80 lines');
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
