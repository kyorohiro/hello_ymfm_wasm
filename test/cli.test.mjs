import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    for(const [format,name] of [['midi','psg-tone'],['musicxml','psg-tone'],['lilypond','psg-tone'],['mgsdrv','ay-tone'],['mxdrv','opm-tone'],['mucom','opn-tone'],['opnavoid','opn-tone']]) {
      const input=fixture(name+'.vgz'),output=join(dir,format);
      const result=cli('export',input,'--format',format,'--output',output,'--bpm','120');
      assert.equal(result.status,0,result.stderr);assert(readFileSync(output).length>0);
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
test('all advertised standalone render adapters initialize their packaged WASM',async()=>{
  const template=await readSource(fixture('psg-tone.vgm'));
  for(const [offset,clock] of [[0x2c,7670454],[0x30,3579545],[0x10,3579545],[0x54,3579545],[0x50,3579545],[0x5c,14318180],[0x74,1789773],[0x80,4194304]]) {
    const source=template.slice(0,260),view=new DataView(source.buffer);
    view.setUint32(4,256,true);view.setUint32(0x0c,0,true);view.setUint32(offset,clock,true);
    source.set([0x61,10,0,0x66],256);
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
  execFileSync(process.execPath,['scripts/build_cli.mjs'],{cwd:root});
  const dir=mkdtempSync(join(tmpdir(),'tetorica-package-'));
  const cache=join(dir,'cache');
  try {
    const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',dir,'--cache',cache],{cwd:root,encoding:'utf8'}))[0];
    const paths=packed.files.map(f=>f.path);
    assert(paths.includes('dist/cli/main.js'));
    assert(paths.includes('dist/docs/generated/ym2612_wasm.wasm'));
    assert(!paths.some(p=>/\.(?:html|css|png|vgz|vgm)$/.test(p)||p.includes('/vendor/')||p.startsWith('w/')));
    execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',dir,'--cache',cache,join(dir,packed.filename)],{encoding:'utf8'});
    const args=['exec','--offline','--prefix',dir,'--cache',cache,'--','tetorica-vgm'];
    const result=JSON.parse(execFileSync('npm',[...args,'analyze',fixture('ay-tone.vgz'),'--json'],{cwd:dir,encoding:'utf8'}));
    assert.equal(result.chips[0].id,'ay8910');
    const wav=join(dir,'tone.wav');
    execFileSync('npm',[...args,'render',fixture('psg-tone.vgz'),'--output',wav,'--max-seconds','0.1'],{cwd:dir});
    assert.equal(readFileSync(wav).subarray(0,4).toString(),'RIFF');
    const api=execFileSync(process.execPath,['--input-type=module','-e',"import {readSource,analyzeSource} from 'tetorica-vgm'; console.log(analyzeSource(await readSource(process.argv[1])).schemaVersion)",fixture('ay-tone.vgz')],{cwd:dir,encoding:'utf8'});
    assert.equal(api.trim(),'1');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
