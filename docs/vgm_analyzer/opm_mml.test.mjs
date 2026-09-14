import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {exportMxdrvMml} from './opm_mml.js';
const wait=n=>[0x61,n&255,n>>8];
function voice(ch=0){const data=[];for(let i=0;i<4;i++)for(const [r,v] of [[0x40,i+1],[0x60,i+10],[0x80,31],[0xa0,10],[0xc0,5],[0xe0,0x47]])data.push(0x54,r+8*i+ch,v);return [...data,0x54,0x20+ch,0xc7,0x54,0x28+ch,0x4a];}
function vgm(commands){const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x30,3579545,true);v.setUint32(0x34,204,true);b.set(commands,256);return b;}
const source=vgm([...voice(),0x54,8,0x78,...wait(22050),0x54,0x28,0x4c,...wait(22050),0x54,8,0,0x66]);
test('MXDRV contains OPM parameters, eight tracks and tied base pitches',()=>{
 const m=exportMxdrvMml(source,{fileName:'song"\n#EX-MDR'});
 assert.match(m,/@0 = \{\n  31, 10, 5, 7, 4, 10, 0, 1, 0, 0, 0,\n  31, 10, 5, 7, 4, 11, 0, 2, 0, 0, 0,/);
 assert.match(m,/  7, 0, 15\n}/);
 assert.match(m,/^A @t215 q8 v15 p3 @0 o4 a4 & o4 a\+4$/m);
 for(const ch of 'BCDEFGH')assert.match(m,new RegExp(`^${ch} @t215 q8 v15 p3 r2$`,'m'));
 assert.equal(m.split('\n').filter(s=>s.startsWith('#')).length,1);
});
test('MXDRV captures new voices on later notes and fills excluded intervals with rests',()=>{
 const m=exportMxdrvMml(vgm([...voice(),0x54,8,0x78,...wait(22050),0x54,8,0,
 0x54,0x60,20,0x54,8,8,...wait(22050),0x54,8,0,0x54,8,0x78,...wait(22050),0x54,8,0,0x66]));
 assert.match(m,/@1 =/);assert.match(m,/^A .*@0 o4 a4 r4 @1 o4 a4$/m);
 assert.throws(()=>exportMxdrvMml(vgm([0x66])),/No convertible/);
 assert.throws(()=>exportMxdrvMml(source,{bpm:0}),/BPM/);
});
test('MXDRV note extraction does not alter original source',()=>{
 const copy=source.slice();assert.equal(exportMxdrvMml(source),exportMxdrvMml(source));assert.deepEqual(source,copy);
});
// Optional real compiler verification. Download the public mml2mdr.js/.wasm to
// an external directory and run MML2MDR_DIR=<directory> node --test this file.
test('mml2mdr compiles generated MML to verified MDX notes and voice bytes',{skip:!process.env.MML2MDR_DIR},async()=>{
 const dir=resolve(process.env.MML2MDR_DIR),factory=createRequire(import.meta.url)(resolve(dir,'mml2mdr.js'));
 const module=await factory({instantiateWasm(imports,ready){WebAssembly.instantiate(readFileSync(resolve(dir,'mml2mdr.wasm')),imports).then(r=>ready(r.instance,r.module));return {};},print(){},printErr(){}});
 const put=s=>{const n=module.lengthBytesUTF8(s)+1,p=module._malloc(n);module.stringToUTF8(s,p,n);return p;};
 const input=put(exportMxdrvMml(source)),filename=put('test.mml');
 try{
 module._mml2mdr_compile(input,filename,0);assert.equal(module._mml2mdr_ok(),1,module.UTF8ToString(module._mml2mdr_log()));assert.equal(module.UTF8ToString(module._mml2mdr_format()),'MDX');
 const bytes=module.HEAPU8.slice(module._mml2mdr_bytes(),module._mml2mdr_bytes()+module._mml2mdr_size());
 let p=0;while(!(bytes[p]===13&&bytes[p+1]===10&&bytes[p+2]===26)){assert(p<bytes.length);p++;}p+=3;while(bytes[p]!==0){assert(p<bytes.length);p++;}p++;
 const view=new DataView(bytes.buffer);const at=n=>p+view.getUint16(p+n*2);
 assert.deepEqual([...bytes.slice(at(1),at(2))],[255,215,248,8,251,15,252,3,253,0,182,47,247,183,47,241,0]);
 // MDX stores operators in 1/3/2/4 order; input MML rows are register order.
 assert.deepEqual([...bytes.slice(at(0),at(0)+11)],[0,7,15,1,3,2,4,10,12,11,13]);
 }finally{module._free(input);module._free(filename);}
});

test('MML dialog offers MXDRV only for YM2151 and keeps OPN choices',async()=>{
 const vm=await import('node:vm');const script=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 let click,submit;const buttons=['mucom88','opnavoid','mxdrv','cancel'].map(value=>({value}));const downloads=[];
 const ctx=vm.createContext({currentChipKind:'ym2151',currentBuffer:source,exportMmlButton:{addEventListener:(_,fn)=>click=fn},mmlFormatDialog:{querySelectorAll:()=>buttons,querySelector:()=>({addEventListener:(_,fn)=>submit=fn}),showModal(){}},downloadMml:f=>downloads.push(f)});
 vm.runInContext(script.slice(script.indexOf('exportMmlButton.addEventListener("click"'),script.indexOf('exportMidiButton.addEventListener("click"')),ctx);
 click();assert.equal(buttons[0].disabled,true);assert.equal(buttons[2].disabled,false);submit({submitter:{value:'mxdrv'}});assert.deepEqual(downloads,['mxdrv']);
 ctx.currentChipKind='ym2612';click();assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].hidden,false);assert.equal(buttons[2].disabled,true);
});
