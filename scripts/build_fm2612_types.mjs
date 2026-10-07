import {readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = join(root, 'dist/fm2612');
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, item.name);
    if (item.isDirectory() && !['sources', 'licenses', 'assets'].includes(item.name)) await walk(path);
    else if (item.isFile() && /\.(?:m?js)$/.test(item.name)) files.push(path);
  }
}
await walk(stage);
const config = join(stage, 'tsconfig.declarations.json');
await writeFile(config, JSON.stringify({compilerOptions: {
  allowJs: true, checkJs: false, declaration: true, emitDeclarationOnly: true,
  noEmitOnError: true, strictNullChecks: true, skipLibCheck: true,
  target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
  rootDir: stage, declarationDir: stage,
  types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
}, files}, null, 2));
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {stdio: 'inherit'});
// Runtime cache-busting URLs are valid in browsers; declaration imports use file paths.
const emitted = [];
async function declarations(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, item.name);
    if (item.isDirectory() && !['sources', 'licenses', 'assets'].includes(item.name)) await declarations(path);
    else if (item.isFile() && /\.d\.(?:m?ts)$/.test(item.name)) {
      const source = await readFile(path, 'utf8');
      let declaration = source.replace(/(\.m?js)\?[^'"\s]+(?=['"])/g, '$1');
      // Worklet processors use a global absent from TypeScript's DOM library.
      // Keep its base private to those modules; do not alter consumer globals.
      if (declaration.includes('extends AudioWorkletProcessor')) declaration = 'declare class AudioWorkletProcessor { readonly port: MessagePort; }\n' + declaration;
      await writeFile(path, declaration);
      emitted.push(path);
    }
  }
}
await declarations(stage);
await writeFile(config, JSON.stringify({compilerOptions: {
  strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022',
  module: 'NodeNext', moduleResolution: 'NodeNext',
  types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
}, files: emitted}, null, 2));
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {stdio: 'inherit'});
await rm(config);
console.log(`Generated and checked ${emitted.length} JSDoc declarations.`);
