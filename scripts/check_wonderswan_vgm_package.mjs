// Verify an already-packed VGM package in an isolated offline consumer.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWonderSwanVgm} from '../test/helpers/wonderswan_vgm_fixture.mjs';
import {createWonderSwanSampleVgm} from '../test/helpers/wonderswan_sample_vgm_fixture.mjs';

assert(process.argv[2],'Pass an existing tetorica-vgm .tgz; this check does not rebuild or publish it.');
const tarball=resolve(process.argv[2]),directory=await mkdtemp(join(tmpdir(),'tetorica-wonderswan-package-'));
const run=(command,args)=>execFileSync(command,args,{cwd:directory,encoding:'utf8',maxBuffer:4*1024*1024});
try {
  await writeFile(join(directory,'package.json'),'{"private":true,"type":"module"}\n');
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',join(directory,'npm-cache'),tarball]);
  const require=createRequire(join(directory,'package.json'));
  const api=await import(pathToFileURL(require.resolve('tetorica-vgm')).href);
  const installed=join(directory,'node_modules/tetorica-vgm');
  for(const name of ['docs/generated/wonderswan_wasm.js','docs/generated/wonderswan_wasm.wasm',
    'docs/js/wonderswanaudioengine.js','docs/vgm_analyzer/wonderswan_notes.js',
    'docs/vgm_analyzer/wonderswan_waves.js','licenses/mame-wonderswan.txt']) {
    assert((await stat(join(installed,name))).size>0,'Missing packed WonderSwan asset: '+name);
  }
  assert.match(await readFile(join(installed,'licenses/mame-wonderswan.txt'),'utf8'),/Redistribution and use/);
  const rows=[];
  for(const mode of ['wave','noise','sweep','voice']) {
    const bytes=createWonderSwanVgm({mode,seconds:.2,loop:false});
    const report=api.analyzeSource(bytes);assert.equal(report.chips[0].id,'wonderswan');
    const wav=await api.renderSource(bytes,{maxSeconds:.1});assert.deepEqual(wav.warnings,[]);
    assert(wav.bytes.subarray(44).some(Boolean),'Silent installed '+mode);
    const channel={wave:1,noise:4,sweep:3,voice:2}[mode];
    const muted=await api.renderSource(bytes,{maxSeconds:.1,mute:['wonderswan-ch-'+channel]});
    assert(muted.bytes.subarray(44).every(v=>v===0),'Installed mute leaked '+mode);
    rows.push({mode,wavBytes:wav.bytes.length,muted:true});
  }
  const source=createWonderSwanVgm({seconds:.2,loop:false});
  assert.equal((await api.inspectSourceSupport(source)).render.status,'configuration-supported');
  for(const format of ['midi','musicxml','lilypond']) {
    const result=api.exportSource(source,{format,bpm:120});
    assert((result.bytes??result.text).length>0,'Empty installed '+format);
  }
  const input=join(directory,'original-wonderswan.vgm'),output=join(directory,'original.wav');
  await writeFile(input,source);
  const cli=join(installed,'cli/main.js');
  const support=JSON.parse(run(process.execPath,[cli,'support',input,'--json']));
  assert.equal(support.render.engine,'wonderswan');
  run(process.execPath,[cli,'render',input,'--max-seconds','.1','--output',output]);
  assert((await readFile(output)).subarray(44).some(Boolean));
  const waveSource=createWonderSwanSampleVgm(),inventory=await api.listSourceSamples(waveSource);
  assert.equal(inventory.samples.length,2);assert(inventory.samples.every(s=>s.representation==='written-wave-ram'));
  const exported=await api.exportSourceSamples(waveSource,{id:1});
  const wave=JSON.parse(new TextDecoder().decode(exported.bytes));assert.deepEqual(wave.waveform.slice(0,6),[1,2,3,4,5,6]);
  assert.equal(wave.packedBytes[0],0x21);assert(wave.observations.some(e=>e.channel===2));
  const preview=await api.exportNodeSamples(waveSource,{id:1,format:'wav',occurrence:2});
  assert.equal(preview.seconds,1);assert.equal(preview.bytes.length,176444);assert(preview.bytes.subarray(44).some(Boolean));
  const waveInput=join(directory,'wave-source.vgm'),waveOutput=join(directory,'wave.json');await writeFile(waveInput,waveSource);
  run(process.execPath,[cli,'samples',waveInput,'--id','1','--output',waveOutput]);
  assert.deepEqual(new Uint8Array(await readFile(waveOutput)),exported.bytes);
  console.log(JSON.stringify({passed:true,offlineInstall:true,cli:true,exports:['midi','musicxml','lilypond'],waveSamples:{count:2,json:true,previewWav:true,cli:true},modes:rows,physicalAudioTested:false}));
} finally {await rm(directory,{recursive:true,force:true});}
