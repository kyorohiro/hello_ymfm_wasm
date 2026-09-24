import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exportSource,listSourceScoreChannels,inspectSourceSupport} from './analyzer_core.js';
import {analyzeLilyPondSource} from './vgm_lilypond.js';
const fixture=n=>readFileSync(new URL(`../../test/fixtures/ymf278b-${n}.vgm`,import.meta.url));
test('YMF278B exports FM while PCM is omitted and no wave ROM is required',async()=>{
 const fm=fixture('fm'),mix=fixture('mix');
 assert.deepEqual(analyzeLilyPondSource(fm).channels,analyzeLilyPondSource(mix).channels);
 assert.equal(listSourceScoreChannels(mix).channels[17].id,'ymf278b-ch18');
 for(const format of ['midi','musicxml','lilypond']){
  const r=exportSource(mix,{format,bpm:120});assert(r.noteCount>0);assert(r.warnings.some(w=>/PCM.*omitted/.test(w)));
 }
 const support=await inspectSourceSupport(mix);
 for(const f of ['midi','musicxml','lilypond'])assert.equal(support.exports[f].status,'available');
 const score=exportSource(mix,{format:'musicxml',bpm:120,channels:['ymf278b-ch1']});
 assert.match(score.text,/YMF278B CH1/);assert.doesNotMatch(score.text,/YMF278B CH2/);
 for(const f of ['musicxml','lilypond'])assert.match(exportSource(mix,{format:f,bpm:120,groups:[{id:'lead',name:'Lead',channels:['ymf278b-ch1','ymf278b-ch2']}]}).text,/Lead/);
});
test('YMF278B PCM-only has no notes, PSG is retained, and dual is rejected',()=>{
 assert(analyzeLilyPondSource(fixture('embedded')).channels.every(c=>!c.notes.length));
 assert.throws(()=>exportSource(fixture('embedded'),{format:'midi',bpm:120}),/No convertible/);
 assert(analyzeLilyPondSource(fixture('psg')).channels.some(c=>/PSG/.test(c.name)&&c.notes.length));
 const b=fixture('fm');new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(0x60,0x40000000|33868800,true);
 for(const format of ['midi','musicxml','lilypond'])assert.throws(()=>exportSource(b,{format,bpm:120}),/Dual/);
});
test('YMF278B UI enables FM score and MIDI export, enabling PCM Explorer',async()=>{
 const {default:vm}=await import('node:vm');
 const {chipSupportContext}=await import('./test_helpers/chip_support_context.mjs');
 const s=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=s.indexOf('function updateChipSupport()'),end=s.indexOf('\nfunction buildParseInfo',start);
 const c=vm.createContext({...chipSupportContext(),currentChipKind:'ymf278b',currentBuffer:fixture('fm'),midiExportAvailable:true,noteishHeader:{ymf278bClock:33868800},setOutputTab(){}});
 vm.runInContext(s.slice(start,end)+'\nupdateChipSupport();',c);
 for(const key of ['sheetMusicTab','noteishTab','exportMidiButton','exportLilyPondButton'])assert.equal(c[key].disabled,false,key);
 assert.equal(c.sampleTab.disabled,false);assert.equal(c.exportMmlButton.disabled,true);
});
