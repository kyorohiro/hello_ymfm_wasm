// SPDX-License-Identifier: BSD-3-Clause
// Discover browser dependencies, then distribute the authored files unchanged.
// esbuild is only a graph reader here: its generated bundle is never served.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {build} from 'esbuild';

const slash = value => value.split(sep).join('/');
const clean = value => value.replace(/[?#].*$/, '');
const safe = value => typeof value === 'string' && !isAbsolute(value) &&
  /^[\w./+-]+$/.test(value) && !value.split('/').some(part => part === '..' || part === '');

/** Copy a runnable, editable module tree out of docs/. Native-generated loaders
 * are external to this graph and are supplied by the existing artifact copier.
 * @param {{root:string,stage:string,entries:string[],factories:string[]}} options
 */
export async function copyReadableModules({root, stage, entries, factories}) {
  root = resolve(root); stage = resolve(stage);
  assert(entries.length > 0, 'Expected browser module entry points');
  for (const name of [...entries, ...factories]) assert(safe(name) && name.startsWith('docs/'), `Expected a docs/ source path: ${name}`);
  const nativeLoaders = new Set(factories.map(name => resolve(root, name)));
  const result = await build({
    absWorkingDir:root, entryPoints:entries, outdir:join(stage, '.dependency-analysis'),
    bundle:true, preserveSymlinks:true, minify:false, platform:'browser',
    format:'esm', target:'es2022', external:['node:*'], metafile:true,
    write:false, logLevel:'silent', plugins:[{
      name:'preserve-generated-loaders', setup(builder) {
        builder.onResolve({filter:/\.js(?:[?#]|$)/}, args => {
          if (nativeLoaders.has(resolve(args.resolveDir, clean(args.path)))) return {path:args.path, external:true};
        });
      },
    }],
  });
  const inputs = [...new Set(Object.keys(result.metafile.inputs).map(clean))].sort();
  const inputSet = new Set(inputs), modules = [];
  for (const sourcePath of inputs) {
    assert(safe(sourcePath) && sourcePath.startsWith('docs/'), `Browser dependency must be under docs/: ${sourcePath}`);
    const path = sourcePath.slice('docs/'.length), bytes = await readFile(join(root, sourcePath));
    const imports = Object.entries(result.metafile.inputs)
      .filter(([name]) => clean(name) === sourcePath).flatMap(([, value]) => value.imports);
    const localImports = new Set();
    for (const edge of imports) {
      const specifier = edge.original ?? edge.path;
      if (specifier.startsWith('node:') || specifier.startsWith('#')) continue;
      assert(specifier.startsWith('./') || specifier.startsWith('../'), `Unexpected browser dependency: ${sourcePath}: ${specifier}`);
      const dependency = resolve(dirname(join(root, sourcePath)), clean(specifier));
      const canonical = slash(relative(root, dependency));
      assert(inputSet.has(canonical) || nativeLoaders.has(dependency), `Missing browser dependency: ${sourcePath}: ${specifier}`);
      localImports.add(specifier);
    }
    await mkdir(dirname(join(stage, path)), {recursive:true});
    await writeFile(join(stage, path), bytes);
    modules.push({path, sourcePath, bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex'), localImports:[...localImports].sort()});
  }
  return {inputs, modules, entries:entries.map(sourcePath => {
    const entry = modules.find(value => value.sourcePath === sourcePath);
    assert(entry, `Missing browser entry: ${sourcePath}`); return entry;
  })};
}
