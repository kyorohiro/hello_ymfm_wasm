import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSyntheticSpc} from '../web/spc_test_fixture.mjs';
import {analyzeSpcSource,exportSpcAnalysis,listSpcScoreChannels} from '../cli/spc.js';
import {exportFormats} from '../cli/index.js';

const cli = (...args) => spawnSync(process.execPath,['cli/main.js',...args],{encoding:'utf8',maxBuffer:16*1024*1024});
async function withFixture(run) {
  const dir = mkdtempSync(join(tmpdir(),'spc-cli-'));
  const bytes = createSyntheticSpc({voices:2});
  const input = join(dir,'authored-state.bin'); // Signature detection, not extension.
  const referenceFile = join(dir,'references.json');
  const references = [{sampleId:0,note:'A4',cents:0}];
  writeFileSync(input,bytes); writeFileSync(referenceFile,JSON.stringify(references));
  try { await run({dir,input,bytes,referenceFile,references}); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}
const captureFlags = (referenceFile) => ['--spc-seconds','.1','--spc-control-step-ms','0','--spc-references',referenceFile];

test('SPC CLI analysis and stable channel IDs match the Node facade, with explicit units and manual BRR reference',async()=>{
  await withFixture(async({input,bytes,referenceFile,references})=>{
    const expected = await analyzeSpcSource(bytes,{durationSeconds:.1,controlStepMs:0,references});
    const result = cli('analyze',input,...captureFlags(referenceFile),'--json');
    assert.equal(result.status,0,result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.deepEqual(actual,expected);
    assert.equal(actual.format,'SPC'); assert.equal(actual.displayRate,44100);
    assert.equal(actual.clockRate,1024000); assert.equal(actual.time,4410);
    assert.equal(actual.channels.length,8); assert.equal(actual.channels[0].notes[0].midi,69);
    assert.deepEqual(actual.references,[{sampleId:0,referenceHz:440,kind:'manual'}]);
    assert.match(result.stderr,/Warning:/);
    const list = cli('score-channels',input,...captureFlags(referenceFile),'--json');
    assert.equal(list.status,0,list.stderr);
    assert.deepEqual(JSON.parse(list.stdout),listSpcScoreChannels(expected));
    assert.deepEqual(JSON.parse(list.stdout).channels.map(ch=>ch.id),Array.from({length:8},(_,i)=>`snes-voice-${i+1}`));
    const summary = cli('analyze',input,...captureFlags(referenceFile));
    assert.equal(summary.status,0,summary.stderr);
    assert.match(summary.stdout,/Captured duration: 0\.100 s \(initial interval only\)/);
    assert.match(summary.stdout,/44,100 display ticks/); assert.match(summary.stdout,/BRR 0: 440 Hz/);
  });
});

test('SPC CLI MIDI, selected staves and grouped scores equal direct API exports and require --force to overwrite',async()=>{
  await withFixture(async({dir,input,bytes,referenceFile,references})=>{
    const score = await analyzeSpcSource(bytes,{durationSeconds:.1,controlStepMs:0,references});
    const cases = [
      {format:'midi',options:{},flags:[]},
      {format:'musicxml',options:{channels:['snes-voice-2']},flags:['--channels','snes-voice-2']},
      {format:'lilypond',options:{channels:['snes-voice-1','snes-voice-2'],group:['Both=snes-voice-1,snes-voice-2']},flags:['--channels','snes-voice-1,snes-voice-2','--group','Both=snes-voice-1,snes-voice-2']},
      {format:'musicxml',options:{mergeAll:true},flags:['--merge-all']},
    ];
    for (const [index,{format,options,flags}] of cases.entries()) {
      const output = join(dir,`output-${index}.${format}`);
      const expected = exportSpcAnalysis(score,{format,bpm:120,fileName:'authored-state.bin',...options});
      const args = ['export',input,...captureFlags(referenceFile),'--format',format,'--bpm','120','--output',output,...flags];
      const result = cli(...args); assert.equal(result.status,0,result.stderr);
      assert.deepEqual(readFileSync(output),Buffer.from(expected.bytes ?? expected.text));
      writeFileSync(output,'existing user file');
      const noOverwrite = cli(...args); assert.equal(noOverwrite.status,1,noOverwrite.stderr);
      assert.match(noOverwrite.stderr,/EEXIST/); assert.equal(readFileSync(output,'utf8'),'existing user file');
      const forced = cli(...args,'--force'); assert.equal(forced.status,0,forced.stderr);
      assert.deepEqual(readFileSync(output),Buffer.from(expected.bytes ?? expected.text));
    }
  });
});

test('SPC support uses real score exporters and explicitly separates unsupported render, samples and patch formats',async()=>{
  await withFixture(async({input,bytes,referenceFile,references})=>{
    const score = await analyzeSpcSource(bytes,{durationSeconds:.1,controlStepMs:0,references});
    const result = cli('support',input,...captureFlags(referenceFile),'--json');
    assert.equal(result.status,0,result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.format,'SPC'); assert.equal(report.analysis.durationSeconds,.1);
    assert.equal(report.render.status,'unsupported'); assert.match(report.render.reason,/SPC PCM rendering/);
    assert.equal(report.samples.status,'unsupported');
    assert.deepEqual(Object.keys(report.exports),exportFormats);
    assert.deepEqual(report.scoreChannels.result,listSpcScoreChannels(score));
    for (const format of ['midi','musicxml','lilypond']) {
      const output = exportSpcAnalysis(score,{format,bpm:120});
      assert.equal(report.exports[format].status,'available');
      assert.deepEqual(report.exports[format].warnings,output.warnings);
    }
    assert.equal(report.exports.tfi.status,'unsupported');
    assert(report.limitations.some(text=>/first 0.1 seconds/.test(text)));
    assert(report.limitations.some(text=>/real exporters/.test(text)));
  });
});

test('SPC default capture respects the tagged duration and zero control coalescing is accepted',async()=>{
  await withFixture(async({input,bytes})=>{
    bytes[0x23] = 0x1a;
    bytes.set(new TextEncoder().encode('001'),0xa9);
    bytes.set(new TextEncoder().encode('00000'),0xac);
    writeFileSync(input,bytes);
    const result = cli('analyze',input,'--json','--spc-control-step-ms','0');
    assert.equal(result.status,0,result.stderr);
    const score = JSON.parse(result.stdout);
    assert.equal(score.metadata.durationSeconds,1); assert.equal(score.durationSeconds,1);
    assert.equal(score.time,44100);
  });
});

test('SPC unsupported commands, formats and invalid export options fail without writing files',async()=>{
  await withFixture(async({dir,input,referenceFile})=>{
    for (const [command,flags,pattern] of [
      ['to-json',[],/SPC to-json is not supported/],
      ['from-json',[],/SPC from-json is not supported/],
      ['render',['--max-seconds','.1'],/SPC render is not supported/],
      ['samples',['--all'],/SPC samples is not supported/],
      ['export',['--format','tfi',...captureFlags(referenceFile)],/SPC export supports/],
      ['export',['--format','midi','--at','0',...captureFlags(referenceFile)],/does not accept --at/],
      ['export',['--format','midi','--channels','snes-voice-1',...captureFlags(referenceFile)],/Channel selection/],
      ['export',['--format','midi','--merge-all',...captureFlags(referenceFile)],/Grouping/],
      ['export',['--format','musicxml','--channels','missing',...captureFlags(referenceFile)],/Unknown score channel/],
      ['export',['--format','musicxml','--channels','snes-voice-1,snes-voice-1',...captureFlags(referenceFile)],/unique channel/],
      ['export',['--format','musicxml','--group','Bad=missing',...captureFlags(referenceFile)],/channel/i],
      ['export',['--format','musicxml','--bpm','NaN',...captureFlags(referenceFile)],/BPM/],
    ]) {
      const output = join(dir,'must-not-be-written');
      const result = cli(command,input,...flags,'--output',output);
      assert.equal(result.status,1,result.stderr); assert.match(result.stderr,pattern);
      assert.equal(existsSync(output),false,`${command} must not create output on error`);
    }
    const listing = cli('samples',input); assert.equal(listing.status,1); assert.match(listing.stderr,/SPC samples is not supported/);
  });
});

test('SPC options reject invalid bounds, malformed references, foreign inputs and oversized or truncated SPCs',async()=>{
  await withFixture(async({dir,input,referenceFile})=>{
    for (const [flag,value] of [['--spc-seconds','0'],['--spc-seconds','601'],['--spc-seconds','NaN'],['--spc-seconds','Infinity'],['--spc-seconds',' '],['--spc-control-step-ms','-1'],['--spc-control-step-ms','1001']]) {
      const result = cli('analyze',input,`${flag}=${value}`,'--json');
      assert.equal(result.status,1,result.stderr); assert.match(result.stderr,/finite number/);
    }
    for (const [text,pattern] of [
      ['{}',/JSON array/],['broken json',/JSON/],
      ['[{"sampleId":0,"note":"H4"}]',/note/i],
      ['[{"sampleId":0,"referenceHz":-1}]',/referenceHz/],
      ['[{"sampleId":255,"note":"C4"}]',/Unknown BRR sampleId/],
    ]) {
      writeFileSync(referenceFile,text);
      const result = cli('analyze',input,...captureFlags(referenceFile));
      assert.equal(result.status,1,result.stderr); assert.match(result.stderr,pattern);
    }
    writeFileSync(referenceFile,' '.repeat(1024*1024+1));
    const hugeRefs = cli('analyze',input,...captureFlags(referenceFile));
    assert.equal(hugeRefs.status,1); assert.match(hugeRefs.stderr,/1 MiB/);
    const vgm = new URL('./fixtures/psg-tone.vgm',import.meta.url).pathname;
    for (const flag of ['--spc-seconds','--spc-control-step-ms','--spc-references']) {
      const result = cli('analyze',vgm,flag,flag.endsWith('references')?referenceFile:'1');
      assert.equal(result.status,1); assert.match(result.stderr,/requires an SPC input/);
    }
    const truncated = join(dir,'truncated.spc');
    writeFileSync(truncated,new TextEncoder().encode('SNES-SPC700 Sound File Data'));
    const bad = cli('analyze',truncated,'--spc-seconds','.1');
    assert.equal(bad.status,1); assert.match(bad.stderr,/Truncated SPC/);
    truncateSync(input,16*1024*1024+1);
    const huge = cli('analyze',input,'--spc-seconds','.1');
    assert.equal(huge.status,1); assert.match(huge.stderr,/16 MiB/);
  });
});
