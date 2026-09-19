import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readSource,exportSource,listSourceScoreChannels} from '../cli/index.js';
import {analyzeLilyPondSource,createLilyPondScore} from '../docs/vgm_analyzer/vgm_lilypond.js';
import {createMusicXmlScore} from '../docs/vgm_analyzer/vgm_musicxml.js';
const fixture=n=>new URL('./fixtures/'+n+'.vgz',import.meta.url);
test('Score IDs and selected staves use Browser exporters with unchanged timing and BPM',async()=>{
 for(const name of ['opn-tone','psg-tone','opm-audible']){
  const source=await readSource(fixture(name)),list=listSourceScoreChannels(source),score=analyzeLilyPondSource(source);
  assert.equal(list.channels.length,score.channels.length);
  assert.equal(new Set(list.channels.map(ch=>ch.id)).size,list.channels.length);
  const ids=[list.channels.at(-1).id,list.channels[0].id];
  const selected=score.channels.filter((_,i)=>i===0||i===score.channels.length-1);
  for(const [format,create] of [['musicxml',createMusicXmlScore],['lilypond',createLilyPondScore]]){
   const actual=exportSource(source,{format,channels:ids});
   assert.equal(actual.text,create(selected,score.time,{bpm:score.tempo.bpm,fileName:'VGM',warnings:score.warnings}).text);
   assert.equal(exportSource(source,{format}).text,create(score.channels,score.time,{bpm:score.tempo.bpm,fileName:'VGM',warnings:score.warnings}).text);
  }
  const cli=spawnSync(process.execPath,['cli/main.js','score-channels',fixture(name).pathname,'--json'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),list);
 }
});
test('Score selection rejects unknown, duplicate, empty IDs and other formats',async()=>{
 const source=await readSource(fixture('opn-tone'));
 for(const channels of [[],['bogus'],['ym2612-ch1','ym2612-ch1'],'ym2612-ch1',['']])
  assert.throws(()=>exportSource(source,{format:'musicxml',channels}),/channel/i);
 for(const format of ['midi','tfi-zip','vgi','opm'])
  assert.throws(()=>exportSource(source,{format,channels:['ym2612-ch1']}),/selection/);
});
