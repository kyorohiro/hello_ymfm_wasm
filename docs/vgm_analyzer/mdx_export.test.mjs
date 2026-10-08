import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {exportMdx} from './mdx_export.js';
import {exportSource, exportFormats} from './analyzer_core.js';
const wait = n => [0x61,n&255,n>>8];
function voice(ch=0) {
  const data=[];
  for(let i=0;i<4;i++)for(const [r,v] of [[0x40,i+1],[0x60,i+10],[0x80,31],[0xa0,10],[0xc0,5],[0xe0,0x47]])data.push(0x54,r+8*i+ch,v);
  return [...data,0x54,0x20+ch,0xc7,0x54,0x28+ch,0x4a];
}
function vgm(commands) {
  const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
  b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);b.set(commands,256);return b;
}
const source=vgm([...voice(),0x54,8,0x78,...wait(22050),0x54,0x28,0x4c,...wait(22050),0x54,8,0,0x66]);
function readHeader(bytes) {
  let base=0;while(!(bytes[base]===13&&bytes[base+1]===10&&bytes[base+2]===26)){assert.ok(base<bytes.length);base++;}
  const title=bytes.slice(0,base);base+=3;assert.equal(bytes[base++],0);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const at=n=>base+view.getUint16(base+n*2);
  const voices=at(0);const starts=Array.from({length:9},(_,i)=>at(i+1));
  assert.equal(starts[0]-base,20);
  return {title,voices,tracks:starts.map((start,i)=>bytes.slice(start,starts[i+1]??voices))};
}
test('MDX matches independently verified mml2mdr FM opcodes and logical voice bytes',()=>{
  const result=exportMdx(source,{fileName:'test'});const header=readHeader(result.bytes);
  // Same reference bytes as the real mml2mdr compiler in opm_mml.test.mjs.
  assert.deepEqual([...header.tracks[0]],[255,215,248,8,251,15,252,3,253,0,182,47,247,183,47,241,0]);
  assert.deepEqual([...result.bytes.slice(header.voices)],[0,7,15,1,3,2,4,10,12,11,13,31,31,31,31,10,10,10,10,5,5,5,5,0x47,0x47,0x47,0x47]);
  for(const track of header.tracks.slice(1,8))assert.deepEqual([...track],[255,215,248,8,251,15,252,3,95,241,0]);
  assert.deepEqual([...header.tracks[8]],[241,0]);
  assert.equal(result.voiceCount,1);assert.equal(result.extension,'mdx');
  assert.ok(result.warnings.some(w=>/noise/.test(w)));
  assert.ok(exportFormats.includes('mdx'));assert.deepEqual(exportSource(source,{format:'mdx',bpm:120,fileName:'test'}),result);
  assert.deepEqual(exportMdx(source,{fileName:'test'}),result);
});
test('MDX long notes are tied and long rests split into legal durations',()=>{
  const held=vgm([...voice(7),0x54,8,0x7f,...Array.from({length:12},()=>wait(44100)).flat(),0x54,8,7,...wait(44100),0x66]);
  const {tracks}=readHeader(exportMdx(held).bytes);
  let ticks=0,notes=0,ties=0;const h=tracks[7];
  for(let i=10;i<h.length-2;){const command=h[i++];if(command<128)ticks+=command+1;else if(command<224){ticks+=h[i++]+1;notes++;}else if(command===247)ties++;else assert.fail(`Unexpected ${command}`);}
  assert.ok(notes>1);assert.equal(ties,notes-1);
  assert.equal(ticks,Math.round(13*44100*(78125/(16*41))*4/(44100*60))*12);
  const a=tracks[0];assert.ok(a.filter(x=>x===127).length>1);
});
test('MDX voices change only at note boundaries and header preserves Shift_JIS title',()=>{
  const changed=vgm([...voice(),0x54,8,0x78,...wait(22050),0x54,8,0,0x54,0x60,40,0x54,8,0x78,...wait(22050),0x54,8,0,0x66]);
  const result=exportMdx(changed,{fileName:'テスト曲 🎵\n'});const {title,tracks}=readHeader(result.bytes);
  assert.equal(new TextDecoder('shift_jis').decode(title),'テスト曲 ?');
  assert.equal(result.voiceCount,2);assert.ok(result.warnings.some(w=>/Shift_JIS/.test(w)));
  assert.deepEqual([...tracks[0]],[255,215,248,8,251,15,252,3,253,0,182,47,253,1,182,47,241,0]);
});
test('MDX rejects unsupported sources, empty notes, bad tempo and offset overflow',()=>{
  assert.throws(()=>exportMdx(vgm([0x66])),/No convertible/);
  assert.throws(()=>exportMdx(source,{bpm:33}),/BPM/);
  const dual=source.slice();new DataView(dual.buffer).setUint32(0x30,3579545|0x40000000,true);assert.throws(()=>exportMdx(dual),/Dual/);
  const absent=source.slice();new DataView(absent.buffer).setUint32(0x30,0,true);assert.throws(()=>exportMdx(absent),/clock/);
  const huge=vgm([...voice(),0x54,8,0x78,...Array.from({length:14000},()=>wait(65535)).flat(),0x54,8,0,0x66]);
  assert.throws(()=>exportMdx(huge,{bpm:999}),/16-bit/);
});
test('browser MDX download uses binary bytes, .mdx extension and conversion notices',()=>{
  const script=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');let blob,anchor,status;
  const ctx=vm.createContext({currentBuffer:source,currentChipKind:'ym2151',mmlBpmInput:{reportValidity:()=>true,value:120},lastLoadedFileName:'song.vgm',exportMdx,Blob,
    URL:{createObjectURL:value=>{blob=value;return 'blob:test';},revokeObjectURL(){}},document:{createElement:()=>anchor={click(){}}},setStatus:value=>status=value,setTimeout(){}});
  vm.runInContext(script.slice(script.indexOf('function downloadMml('),script.indexOf('exportMmlButton.addEventListener("click"')),ctx);
  ctx.downloadMml('mdx');assert.equal(anchor.download,'song.mdx');assert.equal(blob.type,'application/octet-stream');assert.match(status,/Exported MDX/);assert.match(status,/no PDX|PCM\/PDX/);
});
