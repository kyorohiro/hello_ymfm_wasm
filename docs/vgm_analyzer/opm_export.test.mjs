import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmState,mountOpmMonitor} from './opm_monitor.js';
import {exportOpm,extractOpmPatches} from './opm_export.js';
test('OPM text preserves distinct register slots, channel settings and global LFO',()=>{
 const s=createOpmState();
 for(let i=0;i<4;i++)for(const [r,v] of [[0x40,0x20+i],[0x60,40+i],[0x80,0x80+10+i],[0xa0,0x80+12+i],[0xc0,0x40+14+i],[0xe0,0x60+3+i]])s.write(r+i*8+7,v);
 for(const [r,v] of [[0x27,0xdd],[0x3f,0x62],[0x18,123],[0x19,45],[0x19,0xd6],[0x1b,3],[15,0x95],[8,0x7f]])s.write(r,v);
 const text=exportOpm(s.snapshot(),7,'Example');
 const rows=text.split(/\r?\n/).filter(line=>line&&!line.startsWith('//'));
 assert.deepEqual(rows,[
 '@:0 Example','LFO: 123 45 86 3 21','CH: 192 3 5 2 6 120 128',
 'M1: 10 12 14 3 6 40 2 0 2 1 128','C1: 11 13 15 4 6 41 2 1 2 1 128',
 'M2: 12 14 16 5 6 42 2 2 2 1 128','C2: 13 15 17 6 6 43 2 3 2 1 128']);
 assert.match(exportOpm(s.snapshot(),0),/CH: 0 0 0 0 0 120 0/);
 s.write(8,0x17);assert.match(exportOpm(s.snapshot(),7),/ 16 128\r\n/);
 s.write(8,7);assert.match(exportOpm(s.snapshot(),7),/ 120 128\r\n/);
 assert.equal(exportOpm(s.snapshot(),0,'a\n@:9 fake').split(/\r?\n/).filter(l=>l.startsWith('@:')).length,1);
 assert.throws(()=>exportOpm(s.snapshot(),8),RangeError);
});
test('Monitor is read-only; Export group downloads all CH snapshots at click time',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const old=globalThis.document,buttons=[];
 globalThis.document={createElement(tag){if(tag==='button')buttons.push(tag);return {style:{},append(){}};}};
 try{mountOpmMonitor({append(){}},()=>0);assert.equal(buttons.length,0);}finally{globalThis.document=old;}
 const state=createOpmState();state.write(0x67,77);
 let handler,blob;const downloads=[];
 const ctx=vm.createContext({noteishHeader:{ym2151Clock:4000000},currentChipKind:'ym2151',currentBuffer:new Uint8Array(1),exportOpmButton:{addEventListener:(_,fn)=>handler=fn},opmMonitor:state,exportOpm,lastLoadedFileName:'song.vgm',Blob,TextEncoder,CRC32_TABLE:Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;}),
 URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},setTimeout:fn=>fn(),setStatus(){},
 document:{body:{append(){}},createElement(){return {click(){downloads.push(this.download);},remove(){}};}}});
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf("function crc32("),source.indexOf("function downloadAllTfiZip(")),ctx);
 vm.runInContext(source.slice(source.indexOf("exportOpmButton.addEventListener('click'"),source.indexOf('const ayMonitorRoot =')),ctx);
 handler();assert.deepEqual(downloads,['song_snapshot_opm.zip']);assert.equal(blob.type,'application/zip');
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);let offset=0;const entries=[];
 while(view.getUint32(offset,true)===0x04034b50){const len=view.getUint32(offset+18,true),nameLen=view.getUint16(offset+26,true);entries.push([new TextDecoder().decode(bytes.slice(offset+30,offset+30+nameLen)),new TextDecoder().decode(bytes.slice(offset+30+nameLen,offset+30+nameLen+len))]);offset+=30+nameLen+len;}
 assert.deepEqual(entries.map(e=>e[0]),Array.from({length:8},(_,i)=>`CH${i+1}.opm`));
 assert.match(entries[7][1],/M1: 0 0 0 0 0 77 /);assert.match(entries[0][1],/M1: 0 0 0 0 0 0 /);
 state.write(0x67,22);handler();assert.match(await blob.text(),/M1: 0 0 0 0 0 22 /);
 ctx.currentChipKind='ym2612';handler();assert.equal(downloads.length,2);
});

test('All OPM scans the full track, deduplicates per CH and retains held-key changes',()=>{
 const commands=[0x54,0x60,10,0x54,8,0x78,0x61,100,0,
  0x54,0x60,20,0x54,0x60,20,0x54,0x28,0x4a,
  0x54,8,0,0x54,0x60,30,0x61,50,0,0x54,8,0x78,
  0x54,8,0,0x54,0x60,10,0x54,8,0x78,
  0x54,0x61,10,0x54,8,0x79,0x54,0x19,7,0x66];
 const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);b.set(commands,256);
 const patches=extractOpmPatches(b);
 assert.deepEqual(patches.map(p=>[p.name,p.sample]),[['CH1_001.opm',0],['CH1_002.opm',100],['CH1_003.opm',150],['CH2_001.opm',150],['CH1_004.opm',150],['CH2_002.opm',150]]);
 assert.match(patches[0].text,/M1: 0 0 0 0 0 10 /);assert.match(patches[1].text,/M1: 0 0 0 0 0 20 /);assert.match(patches[2].text,/M1: 0 0 0 0 0 30 /);
 assert.match(patches[4].text,/LFO: 0 7 0 0 0/);
 assert.deepEqual(extractOpmPatches(b),patches);
 v.setUint32(0x30,3579545|0x40000000,true);assert.throws(()=>extractOpmPatches(b),/single YM2151/);
});
