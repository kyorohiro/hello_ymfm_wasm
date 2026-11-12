import {readdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = join(root, 'dist/fm2612');
// These public SID contracts describe fixed models/clocks and ordered client
// reads. Install them before resolving dependent JS modules, and do not emit
// inferred replacements over declarations that may already be staged.
const sidDeclarations=['sid.d.ts','sid8580.d.ts','sidsynth.d.ts','playground_sid.d.ts','playground_sid_inspector.d.ts'];
const explicitSidModules=new Set(sidDeclarations.map(name=>name.replace(/\.d\.ts$/,'.js')));
for(const name of sidDeclarations)await writeFile(join(stage,name),await readFile(join(root,'tetorica_src/runtime',name)));
const files = [];
async function walk(directory) {
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, item.name);
    // The pinned DX7 distribution already supplies declarations. Regenerating
    // its JS would overwrite .d.ts files resolved by the Playground worklet.
    if (item.isDirectory() && !['sources', 'licenses', 'assets', 'msfa_dx7'].includes(item.name)) await walk(path);
    else if (item.isFile() && /\.(?:m?js)$/.test(item.name)
      && !(directory===stage&&explicitSidModules.has(item.name))) files.push(path);
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
// Browser cache queries are valid module URLs, but TypeScript cannot resolve
// them while inferring JS declarations. Resolve their local files for this
// type-only pass, then restore the exact authored payload even if emission
// fails. Stripping only emitted declaration imports would leave inferred
// clients and Worklet state as `any` before this normalization can help.
const originalSources=[];
try {
  for(const file of files) {
    const source=await readFile(file,'utf8');
    const typeSource=source.replace(/(\.m?js)\?[^'"\s]+(?=['"])/g,'$1');
    if(typeSource!==source){originalSources.push([file,source]);await writeFile(file,typeSource);}
  }
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {stdio: 'inherit'});
} finally {
  for(const[file,source]of originalSources)await writeFile(file,source);
}
// Emscripten's mutable Module object is inferred as Promise<{}>. Expose the
// actual common memory/cwrap ABI required by the standalone SPU wrapper.
await writeFile(join(stage,'generated/ps1_spu_wasm.d.ts'),
  "import type {WasmModuleFactory} from '../soundchip.js';\n"+
  'declare const moduleFactory: WasmModuleFactory;\nexport default moduleFactory;\n');
// SCSP has an explicit local PCM contract rather than the broad inferred JS
// structural types. Keep it when copying the complete runtime payload.
for(const name of ['scsp.d.ts','scspsynth.d.ts','scsp_sample.d.ts'])await writeFile(join(stage,name),await readFile(join(root,'tetorica_src/runtime',name)));
await writeFile(join(stage,'generated/scsp_wasm.d.ts'),
  "import type {WasmModuleFactory} from '../soundchip.js';\n"+
  'declare const moduleFactory: WasmModuleFactory;\nexport default moduleFactory;\n');
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
