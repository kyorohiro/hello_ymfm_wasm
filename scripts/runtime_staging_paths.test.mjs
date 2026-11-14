import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {publishedSourcePath, rewriteStagedModule} from './runtime_staging_paths.mjs';
import {packagedRuntimeModule, publicRuntimeModule} from './runtime_module_layout.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const withoutWebsiteCacheRevisions = text => text.replace(/(\.js)\?v=[A-Za-z0-9._-]+(?=['"])/g, '$1');

test('moved source folders retain historical installed paths without changing public paths', () => {
  for (const [source, target] of [['runtime', 'web'], ['node', 'node'], ['cli', 'cli'], ['native', 'native'], ['wasm', 'wasm']])
    assert.equal(publishedSourcePath(root, join(root, `tetorica_src/${source}/module.js`)), `${target}/module.js`);
  assert.equal(publishedSourcePath(root, join(root, 'docs/js/ym2612.js')), 'docs/js/ym2612.js');
  assert.throws(() => publishedSourcePath(root, join(root, '../outside.js')), /outside repository/);
});

test('CLI staging rewrites dependencies, JSDoc, template URLs and version lookup and executes independently', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tetorica-stage-paths-')));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const repository = join(directory, 'repository'), stage = join(directory, 'stage');
  const file = join(repository, 'tetorica_src/cli/main.mjs');
  const packageFile = join(repository, 'packages/vgm/package.json');
  const source = `import {answer} from '../../docs/answer.mjs?check=1';
import {value} from '../runtime/value.mjs';
/** @type {import('../node/worker.mjs').Worker} */
export const pcm = name => new URL(\`../../docs/generated/\${name}_wasm.wasm\`, import.meta.url);
export const version = new URL('../../packages/vgm/package.json', import.meta.url);
export const result = answer + value;
`;
  const transformed = rewriteStagedModule(source, {root: repository, file, overrides: new Map([[packageFile, 'package.json']])});
  assert.match(transformed, /from '\.\.\/docs\/answer.mjs\?check=1'/);
  assert.match(transformed, /from '\.\.\/web\/value.mjs'/);
  assert.match(transformed, /import\('\.\.\/node\/worker.mjs'\)/);
  assert.match(transformed, /new URL\(`\.\.\/docs\/generated\/\$\{name\}_wasm.wasm`/);
  assert.match(transformed, /new URL\('\.\.\/package.json'/);
  for (const [name, text] of [['cli/main.mjs', transformed], ['docs/answer.mjs', 'export const answer = 40;'], ['web/value.mjs', 'export const value = 2;'], ['package.json', '{"version":"1.2.3"}']]) {
    await mkdir(dirname(join(stage, name)), {recursive: true});
    await writeFile(join(stage, name), text);
  }
  const module = await import(pathToFileURL(join(stage, 'cli/main.mjs')));
  assert.equal(module.result, 42);
  assert.equal(fileURLToPath(module.pcm('ym2612')), join(stage, 'docs/generated/ym2612_wasm.wasm'));
  assert.equal(JSON.parse(await readFile(module.version)).version, '1.2.3');
});

test('moved factory sources reproduce current public module bytes before website cache revisions', async () => {
  const withoutRevisions = withoutWebsiteCacheRevisions;
  for (const name of ['soundchip.js', 'sid_soundchip.js', 'nesapu_wasm.js', 'pwm32x_wasm.js', 'nesapu.js']) {
    const source = await readFile(join(root, 'tetorica_src/runtime', name), 'utf8');
    const published = withoutRevisions(await readFile(join(root, 'docs/js', name), 'utf8'));
    assert.equal(withoutRevisions(publicRuntimeModule(source, name)), published, name);
    if (name === 'nesapu_wasm.js' || name === 'pwm32x_wasm.js') {
      // Only the asset location is adapted. A one-byte change to the right PCM
      // channel offset must still fail the SDK checker's strict byte equality.
      const edited = source.replace('this.ptr+this.capacity*4', 'this.ptr+this.capacity*8');
      assert.notEqual(edited, source, name + ': PCM mutation fixture');
      assert.notEqual(withoutRevisions(publicRuntimeModule(edited, name)), published,
        name + ': layout adaptation must retain PCM byte differences');
    }
    for (const nested of [false, true]) {
      const packaged = packagedRuntimeModule(source, name, {nested});
      if (name === 'nesapu.js') assert.match(packaged, /from '\.\/nesapuaudioengine.js'/);
      else assert(packaged.includes(JSON.stringify(nested ? '../generated/' : './generated/')), name);
    }
  }
});

test('the generic public Worklet retains its exact body and asset paths before website cache revisions', async () => {
  const source=await readFile(join(root,'tetorica_src/runtime/soundchip-output-worklet.js'),'utf8');
  const published=publicRuntimeModule(source,'soundchip-output-worklet.js');
  const website=await readFile(join(root,'docs/js/soundchip-output-worklet.js'),'utf8');
  assert.equal(withoutWebsiteCacheRevisions(published),withoutWebsiteCacheRevisions(website));
  assert(!published.includes("from './generated/"));
  assert(published.includes("from '../generated/ym2612_wasm.js'"));
  assert(published.includes("from './sid_soundchip.js'"));
  const edited=source.replace('this.running = false', 'this.running = true');
  assert.notEqual(edited,source,'Worklet behavior mutation fixture');
  assert.notEqual(withoutWebsiteCacheRevisions(publicRuntimeModule(edited,'soundchip-output-worklet.js')),
    withoutWebsiteCacheRevisions(website),'Cache revision normalization must retain Worklet behavior differences');
  assert.notEqual(withoutWebsiteCacheRevisions(website.replace('./sid_soundchip.js','./other_soundchip.js')),
    withoutWebsiteCacheRevisions(website),'Module targets remain part of the strict comparison');
  assert.notEqual(withoutWebsiteCacheRevisions("import './chip.js?behavior=2'"),"import './chip.js'",
    'Only website v cache tokens are ignored');
});
