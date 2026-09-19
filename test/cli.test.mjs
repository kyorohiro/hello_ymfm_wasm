import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource, analyzeSource, exportSource, renderSource } from '../cli/index.js';
import { Ym2612VGM } from '../docs/js/ym2612vgm.js';
import { exportAnalysisMidi } from '../docs/vgm_analyzer/vgm_midi.js';
import { analyzeLilyPondSource } from '../docs/vgm_analyzer/vgm_lilypond.js';
import { createMusicXmlScore } from '../docs/vgm_analyzer/vgm_musicxml.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=name=>join(root,'test/fixtures',name);
const cli=(...args)=>spawnSync(process.execPath,[join(root,'cli/main.js'),...args],{encoding:'utf8'});

test('VGM/VGZ decode identically; CLI JSON matches browser parser',async()=>{
  for(const name of ['psg-tone','ay-tone','opn-tone','opm-tone']) {
    const raw=await readSource(fixture(name+'.vgm')),gzip=await readSource(fixture(name+'.vgz'));
    assert.deepEqual(raw,gzip);
    const browser=new Ym2612VGM(raw),core=analyzeSource(raw);
    assert.deepEqual(core.header,browser.header);
    assert.deepEqual(core.commandUsage,Object.fromEntries(browser.analyzeCommandUsage()));
    const result=cli('analyze',fixture(name+'.vgz'),'--json');
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),core);
    assert.equal(core.chips.length,1);assert.equal(core.declaredDurationSeconds,.5);
  }
});
test('every advertised export executes through CLI and score output equals browser',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tetorica-export-'));
  try {
    for(const [format,name] of [['opm-zip','opm-audible'],['vgi-zip','ym2610b-fm'],['tfi-zip','ym2203-fm'],['midi','psg-tone'],['musicxml','psg-tone'],['lilypond','psg-tone'],['mgsdrv','ay-tone'],['mxdrv','opm-tone'],['mucom','opn-tone'],['opnavoid','opn-tone']]) {
      const input=fixture(name+'.vgz'),output=join(dir,format);
      const result=cli('export',input,'--format',format,'--output',output,'--bpm','120');
      assert.equal(result.status,0,result.stderr);assert(readFileSync(output).length>0);
    }
    for(const format of ['tfi-zip','vgi-zip','opm-zip']){
      const zipPath=join(dir,format),before=readFileSync(zipPath);
      const input=fixture((format==='opm-zip'?'opm-audible':format==='tfi-zip'?'ym2203-fm':'ym2610b-fm')+'.vgz');
      assert.equal(cli('export',input,'--format',format,'--output',zipPath).status,1);
      assert.deepEqual(readFileSync(zipPath),before);
      assert.equal(cli('export',input,'--format',format,'--output',zipPath,'--force').status,0);
      assert.equal(cli('export',fixture('ym2203-ssg.vgz'),'--format',format,'--output',zipPath,'--force').status,1);
      assert.deepEqual(readFileSync(zipPath),before);
    }
    for(const format of ['tfi','vgi','opm']){
      const input=fixture((format==='opm'?'opm-audible':'opn-tone')+'.vgz'),output=join(dir,'snapshot.'+format);
      const args=['export',input,'--format',format,'--at','0','--channel','1','--output',output];
      assert.equal(cli(...args).status,0);
      const expected=exportSource(await readSource(input),{format,atSeconds:0,channel:1});
      const before=readFileSync(output);assert.deepEqual(before,Buffer.from(expected.bytes??expected.text));
      assert.equal(cli(...args).status,1);
      assert.equal(cli(...args,'--force').status,0);
      assert.equal(cli('export',input,'--format',format,'--at','999999','--channel','1','--output',output,'--force').status,1);
      assert.deepEqual(readFileSync(output),before);
      assert.equal(cli('export',input,'--format',format,'--output',output,'--force').status,1);
    }
    const source=await readSource(fixture('psg-tone.vgm'));
    assert.deepEqual(exportSource(source,{format:'midi',bpm:120}).bytes,exportAnalysisMidi(source,{bpm:120}).bytes);
    const score=analyzeLilyPondSource(source);
    assert.equal(exportSource(source,{format:'musicxml',bpm:120}).text,createMusicXmlScore(score.channels,score.time,{bpm:120,warnings:score.warnings}).text);
    assert(exportSource(source,{format:'midi'}).bytes.length>0);
    assert.notEqual(cli('export',fixture('psg-tone.vgm'),'--format','midi','--output',join(dir,'midi')).status,0);
    assert.equal(cli('export',fixture('psg-tone.vgm'),'--format','midi','--output',join(dir,'midi'),'--force').status,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('offline render produces audible WAV and obeys duration cap',async()=>{
  const source=await readSource(fixture('psg-tone.vgz'));
  const result=await renderSource(source,{maxSeconds:.1});
  assert.equal(Buffer.from(result.bytes.slice(0,4)).toString(),'RIFF');
  assert(result.bytes.slice(44).some(x=>x!==0));assert.equal(result.truncated,true);
  assert(Math.abs(result.seconds-.1)<.001);
  await assert.rejects(renderSource(source,{maxSeconds:Infinity}),/maxSeconds/);
  const unsupported=source.slice();new DataView(unsupported.buffer).setUint32(0x48,8000000,true);
  await assert.rejects(renderSource(unsupported),/not supported/);
});
test('Genesis combination renders embedded RF5C164 PCM without dropping it',async()=>{
  const source=await readSource(fixture('genesis-pcm.vgz'));
  for (const psgClock of [3579545,0]) {
    const input=source.slice();new DataView(input.buffer).setUint32(0x0c,psgClock,true);
    const result=await renderSource(input,{maxSeconds:.1});
    assert.deepEqual(result.warnings,[]);
    assert(result.bytes.subarray(44).some(x=>x!==0),'PCM must be audible with silent FM/PSG');
    assert.equal(result.truncated,true);
  }
  const unsupported=source.slice(),view=new DataView(unsupported.buffer);
  view.setUint32(0x2c,0,true);view.setUint32(0x30,3579545,true);
  await assert.rejects(renderSource(unsupported),/not supported/);
});
test('all advertised standalone render adapters initialize their packaged WASM',async()=>{
  const template=await readSource(fixture('psg-tone.vgm'));
  for(const [offset,clock] of [[0x2c,7670454],[0x30,3579545],[0x10,3579545],[0x54,3579545],[0x50,3579545],[0x5c,14318180],[0x74,1789773],[0x80,4194304]]) {
    const source=template.slice(0,263),view=new DataView(source.buffer);
    view.setUint32(4,source.length-4,true);view.setUint32(0x0c,0,true);view.setUint32(offset,clock,true);
    source.set(offset === 0x80 ? [0xb3,0x16,0x80,0x61,10,0,0x66] : [0x61,10,0,0x66],256);
    const wav=await renderSource(source,{maxSeconds:.01});
    assert.equal(Buffer.from(wav.bytes.subarray(0,4)).toString(),'RIFF');
  }
});
test('CLI rejects malformed input, unknown options, unsupported formats and bad BPM',()=>{
  for(const args of [[],['analyze',fixture('psg-tone.vgm'),'--bogus'],['export',fixture('psg-tone.vgm'),'--format','bad','--output','unused'],['export',fixture('psg-tone.vgm'),'--format','midi','--bpm','NaN','--output','unused'],['analyze',fixture('README.md'),'--json']]) {
    const result=cli(...args);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
test('npm tarball installs offline, runs via npx, and exports the library',async()=>{
  const repositoryReadme=readFileSync(join(root,'README.md'),'utf8');
  const dir=mkdtempSync(join(tmpdir(),'tetorica-package-'));
  const cache=join(dir,'cache');
  try {
    const packed=JSON.parse(execFileSync(process.execPath,['scripts/pack_cli.mjs','--json','--pack-destination',dir,'--cache',cache],{cwd:root,encoding:'utf8'}))[0];
    const paths=packed.files.map(f=>f.path);
    assert(paths.includes('dist/cli/main.js'));
    assert(paths.includes('dist/docs/generated/ym2612_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/rf5c164_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/ym2203_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/ym2608_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/ym2610b_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/okim6258_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/y8950_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/ymf278b_wasm.wasm'));
    assert(paths.includes('dist/docs/generated/segapcm_wasm.wasm'));
    assert(paths.includes('dist/licenses/mame-segapcm.txt'));
    assert(paths.includes('dist/docs/generated/k051649_wasm.wasm'));
    assert(paths.includes('dist/licenses/mame-k051649.txt'));
    assert(paths.includes('dist/licenses/mame-okim6258.txt'));
    assert(paths.includes('LICENSE'));
    assert(paths.includes('dist/licenses/jsnes/LICENSE'));
    assert(paths.includes('dist/docs/js/nes_apu_vendor/index.js'));
    assert(!paths.some(p=>/\.rom$|\.bin$/.test(p)));
    assert(!paths.some(p=>/\.(?:html|css|png|vgz|vgm)$/.test(p)||p.includes('/vendor/')||p.endsWith('.s98')||p.startsWith('w/')));
    execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',dir,'--cache',cache,join(dir,packed.filename)],{encoding:'utf8'});
    assert.equal(readFileSync(join(root,'README.md'),'utf8'),repositoryReadme);
    assert.equal(readFileSync(join(dir,'node_modules/tetorica-vgm/README.md'),'utf8'),readFileSync(join(root,'cli/README.md'),'utf8'));
    assert.notEqual(readFileSync(join(dir,'node_modules/tetorica-vgm/README.md'),'utf8'),repositoryReadme);
    const args=['exec','--offline','--prefix',dir,'--cache',cache,'--','tetorica-vgm'];
    const result=JSON.parse(execFileSync('npm',[...args,'analyze',fixture('ay-tone.vgz'),'--json'],{cwd:dir,encoding:'utf8'}));
    assert.equal(result.chips[0].id,'ay8910');
    const wav=join(dir,'tone.wav');
    execFileSync('npm',[...args,'render',fixture('genesis-pcm.vgz'),'--output',wav,'--max-seconds','0.1'],{cwd:dir});
    assert.equal(readFileSync(wav).subarray(0,4).toString(),'RIFF');
    assert(readFileSync(wav).subarray(44).some(x=>x!==0));
    const opnWav=join(dir,'ym2203.wav');
    execFileSync('npm',[...args,'render',fixture('ym2203-mix.vgz'),'--output',opnWav,'--max-seconds','0.1'],{cwd:dir});
    const expected=await renderSource(await readSource(fixture('ym2203-mix.vgz')),{maxSeconds:.1});
    assert.deepEqual(readFileSync(opnWav),Buffer.from(expected.bytes));
    const apiWav=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,renderSource} from 'tetorica-vgm'; process.stdout.write((await renderSource(await readSource(process.argv[1]),{maxSeconds:.1})).bytes)",fixture('ym2203-mix.vgz')],{cwd:dir});
    assert.deepEqual(apiWav,Buffer.from(expected.bytes));
    const romPath=join(dir,'rhythm.bin'),rhythmWav=join(dir,'rhythm.wav');
    const rom=Uint8Array.from({length:8192},(_,i)=>i%2?0x99:0x11);
    writeFileSync(romPath,rom);
    execFileSync('npm',[...args,'render',fixture('ym2608-rhythm.vgz'),'--ym2608-rom',romPath,'--output',rhythmWav,'--max-seconds','0.1'],{cwd:dir});
    const rhythm=await renderSource(await readSource(fixture('ym2608-rhythm.vgz')),{maxSeconds:.1,roms:{ym2608AdpcmA:rom}});
    assert.deepEqual(readFileSync(rhythmWav),Buffer.from(rhythm.bytes));
    const rhythmApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,renderSource} from 'tetorica-vgm'; import {readFile} from 'node:fs/promises'; process.stdout.write((await renderSource(await readSource(process.argv[1]),{maxSeconds:.1,roms:{ym2608AdpcmA:await readFile(process.argv[2])}})).bytes)",fixture('ym2608-rhythm.vgz'),romPath],{cwd:dir});
    assert.deepEqual(rhythmApi,Buffer.from(rhythm.bytes));
    for(const extra of [[],['--ym2608-rom',join(dir,'missing.bin')],['--ym2608-rom',fixture('README.md')]]) {
      const failure=cli('render',fixture('ym2608-rhythm.vgz'),'--output',join(dir,'failed.wav'),...extra);
      assert.equal(failure.status,1);assert.equal(failure.stdout,'');
      assert.match(failure.stderr,/Missing ROM|ENOENT|8192 bytes/);
    }
    assert.equal(cli('analyze',fixture('ym2608-rhythm.vgz'),'--ym2608-rom',romPath).status,1);
    for(const name of ['nes-tone','ym2610-mix','ym2610b-mix','okim6258-tone','opm-oki-mix','y8950-psg','ymf278b-psg','segapcm-bank1','segapcm-opm-psg','msx-scc','msx-ay-opll','msx-ay-opll-audio-scc','pwm-stream','pwm-all']) {
      const out=join(dir,name+'.wav'),input=fixture(name+'.vgz');
      execFileSync('npm',[...args,'render',input,'--output',out,'--max-seconds','0.05'],{cwd:dir});
      const expected=await renderSource(await readSource(input),{maxSeconds:.05});
      assert.deepEqual(readFileSync(out),Buffer.from(expected.bytes));
      const api=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,renderSource} from 'tetorica-vgm'; process.stdout.write((await renderSource(await readSource(process.argv[1]),{maxSeconds:.05})).bytes)",input],{cwd:dir});
      assert.deepEqual(api,Buffer.from(expected.bytes));
    }
    const wavePath=join(dir,'synthetic-wave.bin'),waveOut=join(dir,'opl4.wav');
    const wave=new Uint8Array(2097152);wave.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);
    for(let i=256;i<512;i++)wave[i]=Math.round(Math.sin(i*Math.PI/16)*100)&255;
    writeFileSync(wavePath,wave);
    const waveInput=fixture('ymf278b-external.vgz');
    execFileSync('npm',[...args,'render',waveInput,'--ymf278b-rom',wavePath,'--output',waveOut,'--max-seconds','0.05'],{cwd:dir});
    const waveResult=await renderSource(await readSource(waveInput),{maxSeconds:.05,roms:{ymf278bWave:wave}});
    assert.deepEqual(readFileSync(waveOut),Buffer.from(waveResult.bytes));
    const waveApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,renderSource} from 'tetorica-vgm'; import {readFile} from 'node:fs/promises'; process.stdout.write((await renderSource(await readSource(process.argv[1]),{maxSeconds:.05,roms:{ymf278bWave:await readFile(process.argv[2])}})).bytes)",waveInput,wavePath],{cwd:dir});
    assert.deepEqual(waveApi,Buffer.from(waveResult.bytes));
    for(const extra of [[],['--ymf278b-rom',join(dir,'missing-wave.bin')],['--ymf278b-rom',fixture('README.md')]]) {
      const failure=cli('render',waveInput,'--output',join(dir,'failed-wave.wav'),...extra);
      assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.match(failure.stderr,/Missing ROM|ENOENT|2097152/);
    }
    assert.equal(cli('analyze',waveInput,'--ymf278b-rom',wavePath).status,1);
    const tfiInput=fixture('opm-audible.vgz'),tfiOut=join(dir,'tones.zip');
    execFileSync('npm',[...args,'export',tfiInput,'--format','tfi-zip','--output',tfiOut],{cwd:dir});
    assert.deepEqual(readFileSync(tfiOut),Buffer.from(exportSource(await readSource(tfiInput),{format:'tfi-zip',fileName:'opm-audible.vgz'}).bytes));
    const vgiInput=fixture('ym2610b-fm.vgz'),vgiOut=join(dir,'voices.zip');
    execFileSync('npm',[...args,'export',vgiInput,'--format','vgi-zip','--output',vgiOut],{cwd:dir});
    const vgiExpected=exportSource(await readSource(vgiInput),{format:'vgi-zip'}).bytes;
    assert.deepEqual(readFileSync(vgiOut),Buffer.from(vgiExpected));
    const vgiApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportSource} from 'tetorica-vgm'; process.stdout.write(exportSource(await readSource(process.argv[1]),{format:'vgi-zip'}).bytes)",vgiInput],{cwd:dir});
    assert.deepEqual(vgiApi,Buffer.from(vgiExpected));
    const opmInput=fixture('opm-audible.vgz'),opmOut=join(dir,'opm.zip');
    execFileSync('npm',[...args,'export',opmInput,'--format','opm-zip','--output',opmOut],{cwd:dir});
    const opmExpected=exportSource(await readSource(opmInput),{format:'opm-zip'}).bytes;
    assert.deepEqual(readFileSync(opmOut),Buffer.from(opmExpected));
    const opmApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportSource} from 'tetorica-vgm'; process.stdout.write(exportSource(await readSource(process.argv[1]),{format:'opm-zip'}).bytes)",opmInput],{cwd:dir});
    assert.deepEqual(opmApi,Buffer.from(opmExpected));
    const snapshotOut=join(dir,'snapshot.opm');
    execFileSync('npm',[...args,'export',opmInput,'--format','opm','--at','0','--channel','1','--output',snapshotOut],{cwd:dir});
    const snapshotExpected=exportSource(await readSource(opmInput),{format:'opm',atSeconds:0,channel:1}).text;
    assert.equal(readFileSync(snapshotOut,'utf8'),snapshotExpected);
    const snapshotApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportSource} from 'tetorica-vgm'; process.stdout.write(exportSource(await readSource(process.argv[1]),{format:'opm',atSeconds:0,channel:1}).text)",opmInput],{cwd:dir,encoding:'utf8'});
    assert.equal(snapshotApi,snapshotExpected);
    const samplesInput=fixture('ym2610-adpcm-a.vgz');
    const samplesJson=JSON.parse(execFileSync('npm',[...args,'samples',samplesInput,'--json'],{cwd:dir,encoding:'utf8'}));
    assert.equal(samplesJson.samples[0].representation,'raw-adpcm');
    const samplesApi=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,listSourceSamples} from 'tetorica-vgm'; process.stdout.write(JSON.stringify(await listSourceSamples(await readSource(process.argv[1]))))",samplesInput],{cwd:dir,encoding:'utf8'}));
    assert.deepEqual(samplesJson,samplesApi);
    const sampleOut=join(dir,'samples.zip');
    execFileSync('npm',[...args,'samples',samplesInput,'--all','--output',sampleOut],{cwd:dir});
    const sampleApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportSourceSamples} from 'tetorica-vgm'; process.stdout.write((await exportSourceSamples(await readSource(process.argv[1]),{all:true})).bytes)",samplesInput],{cwd:dir});
    assert.deepEqual(readFileSync(sampleOut),sampleApi);
    const sampleWavOut=join(dir,'sample.wav');
    execFileSync('npm',[...args,'samples',samplesInput,'--id','1','--format','wav','--occurrence','1','--output',sampleWavOut],{cwd:dir});
    const sampleWavApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportNodeSamples} from 'tetorica-vgm'; process.stdout.write((await exportNodeSamples(await readSource(process.argv[1]),{id:1,format:'wav'})).bytes)",samplesInput],{cwd:dir});
    assert.deepEqual(readFileSync(sampleWavOut),sampleWavApi);
    const scoreInput=fixture('opn-tone.vgz');
    const scoreList=JSON.parse(execFileSync('npm',[...args,'score-channels',scoreInput,'--json'],{cwd:dir,encoding:'utf8'}));
    assert.equal(scoreList.channels[0].id,'ym2612-ch1');
    for(const format of ['musicxml','lilypond']){
      const scoreOut=join(dir,'selected.'+format);
      execFileSync('npm',[...args,'export',scoreInput,'--format',format,'--channels','ym2612-ch1','--output',scoreOut],{cwd:dir});
      const scoreApi=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,exportSource} from 'tetorica-vgm'; process.stdout.write(exportSource(await readSource(process.argv[1]),{format:process.argv[2],channels:['ym2612-ch1'],fileName:'opn-tone.vgz'}).text)",scoreInput,format],{cwd:dir,encoding:'utf8'});
      assert.equal(readFileSync(scoreOut,'utf8'),scoreApi);
      const failed=cli('export',scoreInput,'--format',format,'--channels','bad','--output',scoreOut,'--force');
      assert.equal(failed.status,1);assert.equal(readFileSync(scoreOut,'utf8'),scoreApi);
    }
    const muteInput=fixture('opm-audible.vgz'),muteOut=join(dir,'muted.wav');
    execFileSync('npm',[...args,'render',muteInput,'--mute','ym2151-ch-1','--max-seconds','0.03','--output',muteOut],{cwd:dir});
    assert.deepEqual(readFileSync(muteOut),Buffer.from((await renderSource(await readSource(muteInput),{mute:['ym2151-ch-1'],maxSeconds:.03})).bytes));
    const mutedBefore=readFileSync(muteOut);
    assert.equal(cli('render',muteInput,'--mute','bad','--output',muteOut,'--force').status,1);
    assert.deepEqual(readFileSync(muteOut),mutedBefore);
    const regionOut=join(dir,'region.wav');
    execFileSync('npm',[...args,'render',muteInput,'--start','0.01','--max-seconds','0.02','--output',regionOut],{cwd:dir});
    assert.deepEqual(readFileSync(regionOut),Buffer.from((await renderSource(await readSource(muteInput),{startSeconds:.01,maxSeconds:.02})).bytes));
    const regionBefore=readFileSync(regionOut);
    assert.equal(cli('render',muteInput,'--start','600','--output',regionOut,'--force').status,1);
    assert.deepEqual(readFileSync(regionOut),regionBefore);
    const s98Input=fixture('s98-ym2203.s98');
    const s98Summary=JSON.parse(execFileSync('npm',[...args,'analyze',s98Input,'--json'],{cwd:dir,encoding:'utf8'}));
    assert.equal(s98Summary.sourceHeader.format,'S983');
    const documentApi=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {readSourceDocument,analyzeSource} from 'tetorica-vgm'; process.stdout.write(JSON.stringify(analyzeSource(await readSourceDocument(process.argv[1]))))",s98Input],{cwd:dir,encoding:'utf8'}));
    assert.deepEqual(documentApi,s98Summary);
    const s98Out=join(dir,'s98.wav');
    execFileSync('npm',[...args,'render',s98Input,'--output',s98Out,'--max-seconds','0.03'],{cwd:dir});
    assert.deepEqual(readFileSync(s98Out),Buffer.from((await renderSource(await readSource(s98Input),{maxSeconds:.03})).bytes));
    // Machine-readable probe output must remain identical with terminal colors enabled.
    for (const forceColor of ['0','1']) {
      const env={...process.env,FORCE_COLOR:forceColor};
      delete env.NO_COLOR;
      const api=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,analyzeSource} from 'tetorica-vgm'; process.stdout.write(String(analyzeSource(await readSource(process.argv[1])).schemaVersion))",fixture('ay-tone.vgz')],{cwd:dir,encoding:'utf8',env});
      assert.equal(api,'1');
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
