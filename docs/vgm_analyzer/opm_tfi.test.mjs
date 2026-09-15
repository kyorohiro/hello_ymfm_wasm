import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmState} from './opm_monitor.js';
import {exportOpm,extractOpmPatches} from './opm_export.js';
import {convertOpmToTfi,createOpmTfiFiles,OPM_TFI_NOTICE} from './opm_tfi.js';
import {parseTfi} from '../js/tfi.js';
import {tfiToEditorPreset} from '../playground/playground_tfi_editor.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function fixture(){const state=createOpmState(()=>0);state.write(0x20,0xed);for(let i=0;i<4;i++)for(const [r,v] of [[0x40,0x20+i],[0x60,40+i],[0x80,0x80+10+i],[0xa0,0x80+12+i],[0xc0,0x40+14+i],[0xe0,0x60+3+i]])state.write(r+8*i,v);return state.snapshot();}
function bytes(){const commands=[0x54,0x60,10,0x54,8,0x78,0x61,10,0,0x54,0x60,20,0x54,0x60,20,0x66],b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x30,4000000,true);b.set(commands,256);return b;}
test('OPM physical slots map into existing TFI editor logical operators',()=>{
 const s=fixture(),before=structuredClone(s),{data,warnings}=convertOpmToTfi(s,0);assert.equal(data.length,42);const p=parseTfi(data);assert.equal(p.algorithm,5);assert.equal(p.feedback,5);
 const editor=tfiToEditorPreset(data);assert.deepEqual(editor.operators.map(o=>o.tl),[40,42,41,43]);
 for(let i=0;i<4;i++){const offset=2+10*i;assert.equal(data[offset],i);assert.equal(data[offset+2],40+i);assert.equal(data[offset+4],10+i);assert.equal(data[offset+9],0);}
 assert.ok(warnings.some(w=>w.includes('DT2')));assert.ok(warnings.some(w=>w.includes('AM/PM')));assert.deepEqual(s,before);
});
test('All includes held-key changes once; Snapshot includes eight current channels and provenance',()=>{
 const all=createOpmTfiFiles({buffer:bytes(),fileName:'test.vgm'});assert.equal(all.count,2);
 assert.deepEqual(all.files.filter(f=>f.name.endsWith('.tfi')).map(f=>f.name),['CH1_001.tfi','CH1_002.tfi']);
 const info=JSON.parse(new TextDecoder().decode(all.files.at(-1).data));assert.equal(info.entries[1].sample,10);assert.equal(info.entries[0].sourceClockHz,4000000);assert.equal(info.clockCompensation,'none');
 assert.match(new TextDecoder().decode(all.files[1].data),/Tetorica-Source-Clock-Hz: 4000000/);
 const snapshot=createOpmTfiFiles({snapshot:fixture(),clock:4000000,sample:123});assert.equal(snapshot.count,8);assert.equal(snapshot.files.filter(f=>f.name.endsWith('.tfi')).length,8);
 assert.throws(()=>createOpmTfiFiles({snapshot:fixture(),clock:0}),/clock/);
});
test('OPM metadata preserves voice fields and missing clock is not invented',()=>{
 const s=fixture();assert.match(exportOpm(s,0,'test',{clock:4000000}),/Tetorica-Source-Clock-Hz: 4000000/);assert.doesNotMatch(exportOpm(s,0),/Source-Clock/);
 assert.equal(extractOpmPatches(bytes()).length,2);
});
test('actual export dispatch uses All versus Snapshot OPM inputs and downloads ZIP',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8'),downloads=[],inputs=[];let files,status;
 const ctx=vm.createContext({currentChipKind:'ym2151',currentBuffer:bytes(),noteishHeader:{ym2151Clock:4000000},lastLoadedFileName:'song.vgm',player:{processedWaitSamples:123},opmMonitor:{snapshot:fixture},OPM_TFI_NOTICE,
 createOpmTfiFiles:o=>{inputs.push(o);return createOpmTfiFiles(o);},createStoredZip:f=>{files=f;return {};},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},document:{createElement:()=>({click(){downloads.push(this.download);}})},setTimeout:f=>f(),setStatus:s=>status=s});
 vm.runInContext(source.slice(source.indexOf('function downloadOpmTfiZip()')>=0?source.indexOf('function downloadOpmTfiZip()'):source.indexOf('function downloadOpmTfiZip('),source.indexOf('function downloadAllVgiZip(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function downloadSnapshotTfiZip()'),source.indexOf('function downloadSnapshotVgiZip()')),ctx);
 ctx.downloadAllTfiZip();assert.equal(inputs[0].snapshot,undefined);assert.equal(files.filter(f=>f.name.endsWith('.tfi')).length,2);
 ctx.downloadSnapshotTfiZip();assert.equal(inputs[1].snapshot.channels.length,8);assert.equal(files.filter(f=>f.name.endsWith('.tfi')).length,8);assert.deepEqual(downloads,['all_tfi_patches.zip','song_snapshot_tfi.zip']);assert.match(status,/Approximate/);
});
