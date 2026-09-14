import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmState,mountOpmMonitor} from './opm_monitor.js';
import {exportOpm} from './opm_export.js';
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
test('Monitor is read-only; Export group downloads selected CH snapshot at click time',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const old=globalThis.document,buttons=[];
 globalThis.document={createElement(tag){if(tag==='button')buttons.push(tag);return {style:{},append(){}};}};
 try{mountOpmMonitor({append(){}},()=>0);assert.equal(buttons.length,0);}finally{globalThis.document=old;}
 const state=createOpmState();state.write(0x67,77);
 let handler,blob;const downloads=[];
 const ctx=vm.createContext({currentChipKind:'ym2151',currentBuffer:new Uint8Array(1),exportOpmChannel:{value:'7'},exportOpmButton:{addEventListener:(_,fn)=>handler=fn},opmMonitor:state,exportOpm,lastLoadedFileName:'song.vgm',Blob,
 URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},setTimeout:fn=>fn(),setStatus(){},
 document:{body:{append(){}},createElement(){return {click(){downloads.push(this.download);},remove(){}};}}});
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf("exportOpmButton.addEventListener('click'"),source.indexOf('const ayMonitorRoot =')),ctx);
 handler();assert.deepEqual(downloads,['song_CH8.opm']);assert.match(await blob.text(),/M1: 0 0 0 0 0 77 /);
 state.write(0x67,22);handler();assert.match(await blob.text(),/M1: 0 0 0 0 0 22 /);
 ctx.currentChipKind='ym2612';handler();assert.equal(downloads.length,2);
});
