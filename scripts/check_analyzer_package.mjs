// Check literal module dependencies after packaging rewrites, before making the ZIP.
import {readdirSync, readFileSync, statSync, existsSync} from 'node:fs';
import {resolve, dirname, relative, sep} from 'node:path';
const root = resolve(process.argv[2]);
const errors = [];
let checked = 0;
function check(file, specifier, allowDirectory = false) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
  const target = resolve(dirname(file), specifier.split(/[?#]/)[0]);
  checked++;
  if (relative(root, target).startsWith(`..${sep}`) || !existsSync(target) || !(statSync(target).isFile() || (allowDirectory && statSync(target).isDirectory())))
    errors.push(`${relative(root, file)} -> ${specifier}`);
}
function visit(dir) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) { visit(file); continue; }
    if (!/\.(js|html)$/.test(entry.name)) continue;
    const source = readFileSync(file, 'utf8');
    // Covers static imports/re-exports, literal dynamic imports and worker URLs.
    for (const match of source.matchAll(/\b(?:from\s*|import\s*\(?\s*|new\s+URL\s*\(\s*)["']([^"']+)["']/g)) check(file, match[1], match[0].startsWith('new') && match[1].endsWith('/'));
    if (entry.name.endsWith('.html'))
      for (const match of source.matchAll(/\b(?:src|href)=["'](\.[^"']+)["']/g)) check(file, match[1]);
  }
}
visit(root);
if (errors.length) {
  console.error(`Missing/outside package dependencies:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else console.log(`Package dependency check passed (${checked} local references).`);
