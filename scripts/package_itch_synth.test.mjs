import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {copyReadableModules} from './copy_readable_modules.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const expected=['filesystem.js','filesystem_internal.js','workspace.js','path.js','reader.js','sync.js'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Synth standalone explicitly copies the complete working/saved filesystem dependency closure',async()=>{
  const packager=await readFile(join(root,'scripts/package_itch_synth.sh'),'utf8');
  const copied=packager.match(/for file in ([^\n;]+); do\n  cp "\$\{ROOT_DIR\}\/docs\/js\/tetorica_virtual_files/);
  assert(copied,'standalone VFS copy list');
  assert.deepEqual(copied[1].split(/\s+/).sort(),[...expected].sort());
  const project=await readFile(join(root,'docs/synth/synth_project.js'),'utf8');
  assert.match(project,/import\s*\{createVirtualFileWorkspace\}\s*from\s*['"]\.\.\/js\/tetorica_virtual_files\/workspace\.js(?:\?[^'"]*)?['"]/);
  assert.doesNotMatch(copied[1],/git|shell|bundle/,'the two-version core requires no optional Git dependencies');
});

test('other standalone packagers include new filesystem dependencies through readable graph or recursive copying',async()=>{
  for(const name of ['2a03','aswan','dmg','fm2608','huc6280','scsp','sid','snes','spu','ym2149_st']) {
    const source=await readFile(join(root,`scripts/package_itch_${name}_synth.mjs`),'utf8');
    assert.match(source,/import\s*\{\s*copyReadableModules\s*\}/,name);
    assert.match(source,/await copyReadableModules\s*\(/,name);
  }
  const playground=await readFile(join(root,'scripts/package_itch_playground.sh'),'utf8');
  assert.match(playground,/cp -R "\$\{ROOT_DIR\}\/packages\/virtual-files\/src" "\$\{STAGE_DIR\}\/js\/tetorica_virtual_files"/);
});

test('standalone main-module rewriting retains the explicit saved CD-DA file reader inside the package',async()=>{
  const packager=await readFile(join(root,'scripts/package_itch_synth.sh'),'utf8'),source=await readFile(join(root,'docs/synth/synth.js'),'utf8');
  const transform=packager.match(/perl -0pi -e '([^']+)' "\$\{STAGE_DIR\}\/synth\.js"/);
  assert(transform,'main module rewrite');
  const staged=execFileSync('perl',['-pe',transform[1]],{input:source,encoding:'utf8'});
  assert.match(staged,/import\s*\{createCddaInputReader\}\s*from\s*['"]\.\/synth-huc6280\/cdda_inputs\.js['"]/);
  assert.match(packager,/for file in [^\n;]*\bcdda_inputs\.js\b[^\n;]*; do\n  cp "\$\{ROOT_DIR\}\/docs\/synth-huc6280/);
});

test('standalone PSG timed worklet and borrowed worker clients have their register resolver modules',async()=>{
  const packager=await readFile(join(root,'scripts/package_itch_synth.sh'),'utf8');
  const includes=new Set(packager.split('\n'));
  for(const name of [
    'segapsg_operations.js','segapsg_timed_client.js','segapsg_timed_processor.js','segapsg_timed_state.js',
    'gameboy_operations.js','gameboy_timed_client.js','gameboy_timed_state.js',
    'opn_ssg_retained.js','ym2608_operations.js','ym2608_operation_state.js','ym2608_timed_client.js',
    'ym2608_timed_processor.js','ym2608_timed_state.js',
  ])assert(includes.has(name),name);
});

test('readable VFS modules retain canonical source receipts and execute a standalone manual Save/discard/recovery',async t=>{
  const stage=await mkdtemp(join(tmpdir(),'tetorica-synth-vfs-stage-'));t.after(()=>rm(stage,{recursive:true,force:true}));
  const receipt=await copyReadableModules({root,stage,entries:['docs/js/tetorica_virtual_files/workspace.js'],factories:[]});
  assert.deepEqual(receipt.modules.map(module=>module.path).sort(),expected.map(name=>'js/tetorica_virtual_files/'+name).sort());
  for(const module of receipt.modules) {
    const bytes=await readFile(join(stage,module.path)),source=await readFile(join(root,module.sourcePath));
    const canonical=await readFile(join(root,'packages/virtual-files/src',module.path.split('/').at(-1)));
    assert.deepEqual(bytes,source);assert.deepEqual(bytes,canonical);assert.equal(module.bytes,bytes.length);assert.equal(module.sha256,sha(bytes));
  }
  await writeFile(join(stage,'package.json'),'{"type":"module"}\n');
  const checked=execFileSync(process.execPath,['--experimental-vm-modules',join(root,'scripts/check_synth_package.mjs'),stage],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.match(checked,/PASS: \d+ local Synth module\/asset references/);
  const {createVirtualFileWorkspace}=await import(pathToFileURL(join(stage,'js/tetorica_virtual_files/workspace.js')).href);
  const workspace=createVirtualFileWorkspace([{path:'/tone.bin',data:new Uint8Array([1,2])},{path:'/tone.json',data:'accepted'}],{autoSave:false});
  workspace.working.writeFiles([{path:'/tone.bin',data:new Uint8Array([3,4])},{path:'/tone.json',data:'draft'}]);
  assert.equal(workspace.saved.get('/tone.json').data,'accepted');workspace.saveMany(['/tone.bin','/tone.json']);
  assert.deepEqual(workspace.saved.get('/tone.bin').data,new Uint8Array([3,4]));
  workspace.working.delete('/tone.bin');const recovered=createVirtualFileWorkspace();recovered.restore(workspace.snapshot());
  assert.equal(recovered.autoSave,false);assert.equal(recovered.working.has('/tone.bin'),false);recovered.discard('/tone.bin');
  assert.deepEqual(recovered.working.get('/tone.bin').data,new Uint8Array([3,4]));assert.equal(recovered.isDirty(),false);
});
