// SPDX-License-Identifier: BSD-3-Clause
// Read-only, cache-only external diagnostic. The separate GPL reference is not
// linked into Tetorica or copied into any application/source-copy package.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareSid8580Reference} from './prepare_sid8580_reference.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={out:join(root,'docs/issues/sid_waveoff_reference_01.json'),referenceWorkDir:join(root,'build/sid-reference'),datasheet:'/private/tmp/tetorica-mos6581-waveoff.pdf'};
for(let i=2;i<process.argv.length;i++){
  const field={'--out':'out','--reference-work-dir':'referenceWorkDir','--datasheet':'datasheet'}[process.argv[i]],value=process.argv[++i];
  assert(field&&value&&!value.startsWith('--'),'Usage: --out JSON --reference-work-dir CACHE --datasheet CACHED_PDF');options[field]=resolve(value);
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const reference=await prepareSid8580Reference({workDir:options.referenceWorkDir,check:true});
const revision='32c8525418a643eaed8dfafa3d7039e250050cfa';
const archive=join(root,reference.manifest.provenance.archive.path);
const sourceFiles={};
for(const path of ['src/WaveformGenerator.h','src/WaveformGenerator.cpp','src/Voice.h']){
  const bytes=execFileSync('tar',['-xOf',archive,'libresidfp-1.2.3/'+path],{maxBuffer:2*1024*1024});
  const local=await readFile(join(root,'build/sid-reference/libresidfp-'+revision,path));assert(bytes.equals(local));
  sourceFiles[path]={...digest(bytes),url:`https://github.com/libsidplayfp/libresidfp/blob/${revision}/${path}`,matchesPinnedOfficialArchive:true};
}
const pdf=await readFile(options.datasheet);assert.equal(sha(pdf),'0039abf5407b1725b72b0a6418efd37ed2b36577e00035438753754af11f1730');
function run(model,commands){
  const protocol=`SID8PROBE 1 48000 ${model}\n${commands.join('\n')}\n`;
  const result=spawnSync(reference.binary,[],{input:protocol,maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stderr.toString());
  const metadata=JSON.parse(result.stderr.toString());assert.equal(result.stdout.length,metadata.frames*2);
  return {metadata,pcm:result.stdout,protocolSha256:sha(protocol)};
}
const write=(reg,value)=>`w ${reg} ${value}`,clock=value=>`c ${value}`;
const phaseCases=[];
for(const model of [6581,8580])for(const cycles of [137,1234,8193]){
  const variants={};
  for(const [name,control]of [['saw-gate-off',32],['wave-off-gate-off',0],['saw-gate-on',33],['wave-off-gate-on',1],['test-held',8]]){
    const value=run(model,[write(14,0x34),write(15,0x12),write(19,0),write(20,0xf0),write(18,8),clock(8),write(18,control),clock(cycles),write(18,32|(control&1)),clock(2),'r 27','r 28']);
    variants[name]={osc3:value.metadata.reads[0],env3:value.metadata.reads[1],protocolSha256:value.protocolSha256,cycles:value.metadata.cycles};
  }
  const expected=variants['saw-gate-off'].osc3;
  for(const name of ['wave-off-gate-off','saw-gate-on','wave-off-gate-on'])assert.equal(variants[name].osc3,expected);
  assert.notEqual(variants['test-held'].osc3,expected,'TEST must be a positive control, rather than an all-equal empty oracle');
  phaseCases.push({model,freeCycles:cycles,frequencyRegister:0x1234,variants,freePhaseEquivalent:true,testHeldDifferent:true});
}
const modulationCases=[];
for(const model of [6581,8580])for(const [name,bits]of [['sync',2],['ring',4],['sync+ring',6]]){
  const variants={};let baseline;
  for(const [variant,sourceControl]of [['wave-off-gate-off',0],['saw-gate-off',32],['triangle-gate-off',16],['wave-off-gate-on',1],['saw-gate-on',33],['test-held',8]]){
    const commands=[];
    for(let reg=0;reg<=24;reg++)commands.push(write(reg,0));
    commands.push(write(0,0x45),write(1,0x23),write(5,0),write(6,0xf5),write(14,0xbc),write(15,0x1a),write(19,0),write(20,0xf5),write(24,136),write(4,8),write(18,8),clock(8),write(18,sourceControl),write(4,17|bits),clock(60000),'r 27');
    const value=run(model,commands);
    if(!baseline)baseline=value.pcm;
    const same=value.pcm.equals(baseline);assert.equal(same,variant!=='test-held');
    let square=0,peak=0;for(let i=0;i<value.pcm.length;i+=2){const x=value.pcm.readInt16LE(i)/32768;square+=x*x;peak=Math.max(peak,Math.abs(x));}
    const rms=Math.sqrt(square/(value.pcm.length/2));assert(rms>.000001);
    variants[variant]={pcmSha256:sha(value.pcm),frames:value.metadata.frames,osc3:value.metadata.reads[0],rms,peak,equalsWaveOffGateOff:same,protocolSha256:value.protocolSha256};
  }
  modulationCases.push({model,mode:name,sourceFrequencyRegister:0x1abc,carrierFrequencyRegister:0x2345,
    sourceDryOutputDisabled:true,sharedFilterRouting:0,variants,waveAndGateIndependent:true,testHeldDifferent:true});
}
const report={schemaVersion:1,passed:true,purpose:'Independent primary-source and external-engine evidence for oscillator phase with no selected waveform; not an analog DAC timing fit',
  datasheet:{title:'MOS Technology 6581 Sound Interface Device',url:'https://myoldcomputer.nl/Files/mos_6581_sid.pdf',...digest(pdf),pdfPages:[4,5],
    facts:['Page4: Gate controls the envelope attack/release sequence. TEST resets and holds the oscillator at zero.',
      'Page4: source oscillator frequency drives Sync and Ring; the remaining source-voice parameters do not determine these effects.',
      'Page5: the oscillator dependency rotates 3→1, 1→2 and 2→3.'],
    limit:'The datasheet does not specify a waveform-off DAC floating-decay curve or per-cycle phase implementation.'},
  externalSource:{project:'libresidfp',version:'1.2.3',revision,release:'https://github.com/libsidplayfp/libresidfp/releases/tag/v1.2.3',
    archive:reference.manifest.provenance.archive,sourceFiles,
    observations:[{file:'src/WaveformGenerator.h',lines:[315,374],fact:'Clocking advances phase and the noise pipeline whenever TEST is clear; waveform selection and Gate do not gate that clock.'},
      {file:'src/WaveformGenerator.h',lines:[379,425],fact:'Ring uses the preceding accumulator MSB. Waveform-off aging affects a separate output latch.'},
      {file:'src/WaveformGenerator.cpp',lines:[338,345],fact:'Hard Sync follows a source MSB edge, including the simultaneous source-sync suppression case.'},
      {file:'src/WaveformGenerator.cpp',lines:[354,422],fact:'Selecting no waveform starts model-dependent output decay. TEST resets phase separately; latch fading does not rewrite phase.'},
      {file:'src/Voice.h',lines:[67,76],fact:'Oscillator DAC output and envelope output enter the amplitude path separately.'}]},
  execution:{referenceBinary:reference.manifest.binary,manifest:relative(root,reference.manifestPath),
    license:'GPL-2.0-or-later, separate verification executable only',initialization:'Existing pinned serial-filter-table initialization; no oscillator or DSP patch',
    sampleRate:48000,clockHz:985248,sampling:'DECIMATE',accessTiming:'Explicit completed-clock boundaries; accesses consume no implicit ticks',
    phaseCases,modulationCases,cases:phaseCases.length+modulationCases.length,individualRuns:phaseCases.length*5+modulationCases.length*6,
    retainedData:'Metadata and hashes only. No PCM, downloaded PDF, GPL source/library or reference executable is copied to the repository/package.'},
  minimalFixPolicy:{phase:'Advance the 24-bit oscillator and noise-clock state with TEST clear even when all waveform bits or Gate are zero.',
    output:'Keep waveform-off decay on a separate waveform-output latch. Per-cycle halving of that latch remains Tetorica approximation, not measured MOS decay timing.',
    avoid:'Do not preserve the previous phase-halving bug to emulate DAC decay. Do not import GPL implementation or claim reference PCM equality with the Tetorica core.'},
  checker:{path:'scripts/check_sid_waveoff_reference.mjs',...digest(await readFile(fileURLToPath(import.meta.url)))}
};
await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:report.execution.cases,individualRuns:report.execution.individualRuns,out:options.out}));
