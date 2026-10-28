// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ITCH_RELEASE_ARTIFACTS,checkItchReleaseArchives,writeItchReleaseManifest} from './check_itch_release_archives.mjs';
import {prepareItchPlaygroundRun} from './prepare_itch_playground_run.mjs';
const python=process.env.PYTHON||'python3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const zipWriter=String.raw`
import sys,zipfile
from pathlib import Path
root=Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_STORED) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(root).as_posix())
  elif sys.argv[3]=='dirs':z.writestr(p.relative_to(root).as_posix()+'/',b'')
`;
async function put(stage,name,bytes){await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),bytes);}
function zip(release,id,{dirs=false}={}) {const item=ITCH_RELEASE_ARTIFACTS.find(value=>value.id===id);execFileSync(python,['-c',zipWriter,join(release,item.stage),join(release,item.archive),dirs?'dirs':'files']);}
async function fixture(t,{fullDirectories=0}={}) {
  const release=await mkdtemp(join(tmpdir(),'itch four archives '));t.after(()=>rm(release,{recursive:true,force:true}));
  for(const item of ITCH_RELEASE_ARTIFACTS.filter(item=>item.id!=='playground-run')) {
    const stage=join(release,item.stage);
    const files={'index.html':`<!doctype html><script type="module">${item.id==='playground-full'?"import('./playground.js?v=before-bundle');":''}</script>`,
      LICENSE:'Original BSD license fixture\n','THIRD_PARTY_LICENSES.txt':'Original third-party attribution fixture\n',
      'generated/ym2612_wasm.js':'export default function fixture() {}\n','generated/ym2612_wasm.wasm':Buffer.from([0,97,115,109,1,0,0,0])};
    for(const name of item.required)if(!files[name])files[name]=name.endsWith('.json')?'{}\n':'export const fixture=true;\n';
    if(item.id==='playground-full')Object.assign(files,{
      'playground.js':"import {value} from './ui.js';import './js/audio.js';globalThis.itchFixture=value;\n",
      'ui.js':"/*! Original UI legal notice */\nexport const value=42;\nexport const workletURL=base=>new URL('./audio-worklet.js',base).href;\n",
      'js/audio.js':'export const originalAudio=true;\n',
      'js/audio-worklet.js':'export const originalWorklet=true;\n',
      'js/playground_logic_worker.js':'export const logicWorker=true;\n',
      'licenses/chip/NOTICE.md':'Original sound-chip notice\n',
      'sources/Chip.md':'# Original standalone source guide\n',
      'sources/native/chip/core.c':'int core(void){return 1;}\n',
    });
    if(item.id==='playground-full')for(const id of ['cdda','msm5205']) {
      for(const suffix of [`${id}_pcm.c`,`${id}_pcm.h`,`${id}_wasm.c`,'LICENSE','NOTICE.md'])files[`sources/native/${id}/${suffix}`]=`Original ${id}/${suffix}\n`;
      files[`sources/scripts/build_${id}_wasm.sh`]=`#!/bin/sh\n# Original ${id} build recipe\n`;
      files[`licenses/tetorica-${id}/LICENSE`]=files[`sources/native/${id}/LICENSE`];
      files[`licenses/tetorica-${id}/NOTICE.md`]=files[`sources/native/${id}/NOTICE.md`];
    }
    for(const [name,bytes]of Object.entries(files))await put(stage,name,bytes);
  }
  const full=join(release,'itch_playground_dev'),run=join(release,'itch_playground_dev_for_run');
  await prepareItchPlaygroundRun(full,run,{bundle:true});
  for(let i=0;i<fullDirectories;i++)await mkdir(join(full,'download-directory-'+i));
  for(const item of ITCH_RELEASE_ARTIFACTS)zip(release,item.id,{dirs:item.id==='playground-full'});
  return {release,full,run,stage:id=>join(release,ITCH_RELEASE_ARTIFACTS.find(item=>item.id===id).stage),archive:id=>join(release,ITCH_RELEASE_ARTIFACTS.find(item=>item.id===id).archive)};
}
async function check(f){return checkItchReleaseArchives({release:f.release,sourceCommit:null});}
function changeInner(file,name,bytes) {
  execFileSync(python,['-c',String.raw`
import sys,zipfile
from pathlib import Path
p=Path(sys.argv[1])
with zipfile.ZipFile(p) as z:items=[(i,z.read(i)) for i in z.infolist()]
with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_STORED) as z:
 for i,data in items:z.writestr(i,sys.argv[3].encode() if i.filename==sys.argv[2] else data)
`,file,name,bytes]);
}

test('four exact archives yield portable hashes, checksums and distinct playable/download policies',async t=>{
  const f=await fixture(t,{fullDirectories:1005});
  await writeFile(join(f.release,'unrelated-debug.zip'),'Never include this file');
  const out=join(f.release,'itch-web-release.json'),checksums=join(f.release,'SHA256SUMS');
  const manifest=await writeItchReleaseManifest({release:f.release,out,checksums,sourceCommit:'a'.repeat(40)});
  assert.equal(manifest.artifacts.length,4);assert.equal(manifest.artifacts.filter(item=>item.browserPlayable).length,3);
  assert.equal(manifest.audioRebuilt,false);assert.equal(manifest.sourceCommit,'a'.repeat(40));
  assert(manifest.artifacts.find(item=>item.id==='playground-full').zip.entries>1000,'full download may contain directory records beyond hosting limit');
  const lines=(await readFile(checksums,'utf8')).trim().split('\n');assert.equal(lines.length,4);
  for(const [i,item]of manifest.artifacts.entries()) {
    assert.equal(item.sha256,sha(await readFile(f.archive(item.id))));
    assert.equal(lines[i],`${item.sha256}  ${item.archive}`);
    assert.equal(item.downloadOnly,!item.browserPlayable);
  }
  assert.equal(manifest.playgroundRun.correspondingSource.compilationFiles,9);
  assert(manifest.playgroundRun.preservedNotices>=6);
  assert.equal(manifest.playgroundRun.removedRootModules,1);
  assert(!(await readFile(out,'utf8')).includes(f.release),'manifest has no machine-specific absolute paths');
  assert(!(await readFile(out,'utf8')).includes('unrelated-debug.zip'),'checksums and manifest have an explicit artifact allowlist');
});

test('browser-playable archives count directory records toward the 1000 entry limit',async t=>{
  const f=await fixture(t),stage=f.stage('synth');
  for(let i=0;i<1001;i++)await mkdir(join(stage,'browser-directory-'+i));
  zip(f.release,'synth',{dirs:true});
  await assert.rejects(check(f),/Too many files in zip/);
});

test('conservative URL candidates need not exist at the root when their real base is a subdirectory',async t=>{
  const f=await fixture(t),receipt=JSON.parse(await readFile(join(f.run,'sources/browser-bundle.json'),'utf8'));
  assert(receipt.assetModuleRoots.includes('audio-worklet.js'),'the literal URL scanner retains the ambiguous candidate');
  const manifest=await check(f);
  const artifact=manifest.artifacts.find(item=>item.id==='playground-run');
  assert(artifact.files.some(item=>item.path==='js/audio-worklet.js'),'the real unmodified audio asset is present');
  assert(!artifact.files.some(item=>item.path==='audio-worklet.js'),'no artificial root copy is required');
});

test('archive/stage byte mismatch fails before replacing existing outputs',async t=>{
  const f=await fixture(t),out=join(f.release,'itch-web-release.json'),checksums=join(f.release,'SHA256SUMS');
  await writeFile(out,'previous manifest');await writeFile(checksums,'previous checksums');
  await writeFile(join(f.stage('synth'),'synth.js'),'Changed after zip');
  await assert.rejects(writeItchReleaseManifest({release:f.release,out,checksums,sourceCommit:null}),/archive\/stage: file bytes synth.js/);
  assert.equal(await readFile(out,'utf8'),'previous manifest');assert.equal(await readFile(checksums,'utf8'),'previous checksums');
});

test('CRC failures are detected without extracting untrusted paths',async t=>{
  const f=await fixture(t),file=f.archive('synth'),bytes=await readFile(file);
  const offset=30+bytes.readUInt16LE(26)+bytes.readUInt16LE(28);bytes[offset]^=1;await writeFile(file,bytes);
  await assert.rejects(check(f),/Invalid ZIP \/ CRC.*Bad CRC/s);
});

for(const kind of ['unsafe','nul','duplicate','symlink'])test(`${kind} ZIP members are rejected`,async t=>{
  const f=await fixture(t);
  execFileSync(python,['-c',String.raw`
import sys,zipfile,stat,warnings
from pathlib import Path
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1],'a') as z:
 if sys.argv[2]=='unsafe':z.writestr('../outside','unsafe')
 elif sys.argv[2]=='nul':z.writestr('nul-pathXsuffix','unsafe')
 elif sys.argv[2]=='duplicate':z.writestr('index.html','duplicate')
 else:
  i=zipfile.ZipInfo('unsafe-link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'/outside')
if sys.argv[2]=='nul':
 p=Path(sys.argv[1]);p.write_bytes(p.read_bytes().replace(b'nul-pathXsuffix',b'nul-path\x00suffix'))
`,f.archive('synth'),kind]);
  await assert.rejects(check(f),['unsafe','nul'].includes(kind)?/Unsafe ZIP path/:kind==='duplicate'?/Duplicate ZIP entry/:/symlinks/);
});

test('an omitted importer is rejected even if stage and ZIP omit it together',async t=>{
  const f=await fixture(t);await unlink(join(f.stage('synth'),'synth_preset_import.js'));zip(f.release,'synth');
  await assert.rejects(check(f),/missing required file synth_preset_import.js/);
});

test('bundle edits cannot be hidden by repacking the outer ZIP',async t=>{
  const f=await fixture(t);await writeFile(join(f.run,'playground.js'),'globalThis.tampered=true;');zip(f.release,'playground-run');
  await assert.rejects(check(f),/Browser bundle entry bytes/);
});

test('the HTML cache URL must identify the exact bundled entry',async t=>{
  const f=await fixture(t),html=join(f.run,'index.html');
  await writeFile(html,(await readFile(html,'utf8')).replace(/run-bundle-[a-f0-9]{16}/,'run-bundle-0000000000000000'));zip(f.release,'playground-run');
  await assert.rejects(check(f),/HTML imports the receipted browser bundle/);
});

for(const mutation of ['missing','edited'])test(`${mutation} non-root audio module is rejected against the full distribution`,async t=>{
  const f=await fixture(t),audio=join(f.run,'js/audio.js');
  if(mutation==='missing')await unlink(audio);else await writeFile(audio,'export const audioWasAltered=true;');zip(f.release,'playground-run');
  await assert.rejects(check(f),mutation==='missing'?/External browser module exists/:/Unaltered runtime\/audio\/asset\/source\/notice/);
});

test('corresponding source ZIP must preserve every original C/header/build/license byte',async t=>{
  const f=await fixture(t);changeInner(join(f.run,'sources/corresponding-source.zip'),'native/cdda/cdda_pcm.c','Changed original C');zip(f.release,'playground-run');
  await assert.rejects(check(f),/Complete original audio\/build\/license source archive: file bytes native\/cdda\/cdda_pcm.c/);
});

test('archived UI inputs must equal the original full distribution, including root license',async t=>{
  const f=await fixture(t),inner=join(f.run,'sources/browser-bundle-inputs.zip');changeInner(inner,'LICENSE','Changed license');
  const receiptPath=join(f.run,'sources/browser-bundle.json'),receipt=JSON.parse(await readFile(receiptPath,'utf8')),bytes=await readFile(inner);
  receipt.sourceArchive.bytes=bytes.length;receipt.sourceArchive.sha256=sha(bytes);await writeFile(receiptPath,JSON.stringify(receipt));zip(f.release,'playground-run');
  await assert.rejects(check(f),/Complete original UI source archive: file bytes LICENSE/);
});

test('source notices remain accessible and unchanged outside the source ZIP',async t=>{
  const f=await fixture(t);await writeFile(join(f.run,'sources/native/cdda/NOTICE.md'),'Changed notice');zip(f.release,'playground-run');
  await assert.rejects(check(f),/Unaltered runtime\/audio\/asset\/source\/notice: sources\/native\/cdda\/NOTICE.md/);
});

test('unsafe receipt input paths are rejected before opening them',async t=>{
  const f=await fixture(t),path=join(f.run,'sources/browser-bundle.json'),receipt=JSON.parse(await readFile(path,'utf8'));
  receipt.inputs.push({path:'../escape.js',bytes:0,sha256:'0'.repeat(64)});await writeFile(path,JSON.stringify(receipt));zip(f.release,'playground-run');
  await assert.rejects(check(f),/Browser bundle inputs: unsafe path/);
});

test('manifest outputs cannot overwrite any validated artifact or stage input',async t=>{
  const f=await fixture(t);
  await assert.rejects(writeItchReleaseManifest({release:f.release,out:f.archive('synth'),checksums:join(f.release,'SHA256SUMS'),sourceCommit:null}),/cannot overwrite validated inputs/);
  await assert.rejects(writeItchReleaseManifest({release:f.release,out:join(f.run,'index.html'),checksums:join(f.release,'SHA256SUMS'),sourceCommit:null}),/cannot overwrite validated inputs/);
});
