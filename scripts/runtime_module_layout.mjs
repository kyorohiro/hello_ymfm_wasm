import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Source locations are independent of the public and npm runtime layouts.
// Keep these adaptations at the distribution boundary, never in DSP modules.
const generatedFactories = new Map([
  ['soundchip.js', {
    source: "'./generated/'",
    published: "(import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/')",
  }],
  ['nesapu_wasm.js', {
    source: "'./generated/'",
    published: "(import.meta.url.includes('/web/')?'../docs/generated/':'../generated/')",
  }],
  ['pwm32x_wasm.js', {
    source: "'./generated/'",
    published: "(import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/')",
  }],
]);

/** Restore the existing public module bytes after moving development sources. */
export function publicRuntimeModule(source, name) {
  if (name === 'nesapu.js') source = source.replace('../../docs/js/nesapuaudioengine.js', './nesapuaudioengine.js');
  const factory = generatedFactories.get(name);
  if (factory) {
    if (!source.includes(factory.source)) throw new Error(`Missing ${name} default generated asset base`);
    source = source.replace(factory.source, factory.published);
  }
  return source;
}

/** Adapt the three dynamic factories for a flat npm ZIP or nested js/ ZIP. */
export function packagedRuntimeModule(source, name, {nested = false} = {}) {
  if (!nested && ['sid.js', 'playground_sid_audio.js'].includes(name))
    source = source.replaceAll('../generated/sid/', './generated/sid/');
  if (name === 'nesapu.js') source = source.replace('../../docs/js/nesapuaudioengine.js', './nesapuaudioengine.js');
  const factory = generatedFactories.get(name);
  if (factory) {
    if (!source.includes(factory.source)) throw new Error(`Missing ${name} default generated asset base`);
    source = source.replace(factory.source, JSON.stringify(nested ? '../generated/' : './generated/'));
  }
  return source;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/runtime_module_layout.mjs DOCS_JS_DIRECTORY');
  for (const name of [...generatedFactories.keys(), 'nesapu.js']) {
    const file = join(process.argv[2], name);
    await writeFile(file, publicRuntimeModule(await readFile(file, 'utf8'), name));
  }
}
