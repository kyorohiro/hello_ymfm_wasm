import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {exportSource,listSourceScoreChannels} from '../docs/vgm_analyzer/analyzer_core.js';
import {parseMidiFile} from '../web/midi_file.js';

for(const [chip,channel,count] of [['ym3526',1,9],['ym3812',1,9],['ymf262',10,18],['ym2413',1,9],['gameboy',1,3]]) {
  test(`${chip} fixture: VGM/VGZ, audible deterministic render, mute and score exports`,async()=>{
    const source=await readSource(new URL(`./fixtures/${chip}-tone.vgm`,import.meta.url));
    assert.deepEqual(await readSource(new URL(`./fixtures/${chip}-tone.vgz`,import.meta.url)),source);
    const rendered=await renderSource(source,{maxSeconds:.05});
    assert(rendered.bytes.subarray(44).some(v=>v!==0),'audible');
    assert.deepEqual((await renderSource(source,{maxSeconds:.05})).bytes,rendered.bytes);
    const muted=await renderSource(source,{maxSeconds:.05,mute:[`${chip}-ch-${channel}`]});
    assert(muted.bytes.subarray(44).every(v=>v===0),'muted');
    assert.equal(listSourceScoreChannels(source).channels.length,count);
    for(const format of ['midi','musicxml','lilypond']) {
      const result=exportSource(source,{format,bpm:120});
      assert.equal(result.noteCount,1,format);
      if(format==='midi') {
        const notes=parseMidiFile(result.bytes).events.filter(e=>e.kind===9&&e.b>0);
        assert.equal(notes.length,1);
        assert(Math.abs(notes[0].seconds)<1e-6);
      } else assert(result.text.length>0);
    }
  });
}
