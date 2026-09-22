import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const main=fileURLToPath(new URL('../cli/main.js',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,[main,...args],{encoding:'utf8'});
function fixture(kind) {
 const op=kind==='ym3526'?0x5b:0x5a;
 // A4 on CH9 for half a second, followed by half a second of silence.
 const commands=[op,0xa8,68,op,0xb8,50,0x61,0x22,0x56,op,0xb8,18,0x61,0x22,0x56,0x66];
 const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 bytes.write('Vgm ');view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
 view.setUint32(0x34,0xcc,true);view.setUint32(0x18,44100,true);
 view.setUint32(kind==='ym3526'?0x54:0x50,3579545,true);bytes.set(commands,256);return bytes;
}
for(const kind of ['ym3526','ym3812']) {
 test(`${kind} CLI reads VGM/VGZ, lists nine score channels and exports all note formats`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'tetorica-opl-'));
  try {
   const source=fixture(kind);
   for(const ext of ['vgm','vgz']) {
    const input=join(dir,'tone.'+ext);writeFileSync(input,ext==='vgz'?gzipSync(source):source);
    const listed=cli('score-channels',input,'--json');assert.equal(listed.status,0,listed.stderr);
    const channels=JSON.parse(listed.stdout).channels;
    assert.equal(channels.length,9);assert.equal(channels[8].id,`${kind}-ch9`);
    const support=cli('support',input,'--json');assert.equal(support.status,0,support.stderr);
    for(const format of ['midi','musicxml','lilypond']) {
     assert.equal(JSON.parse(support.stdout).exports[format].status,'available');
     const out=join(dir,`${ext}.${format}`);
     const args=['export',input,'--format',format,'--bpm','120','--output',out];
     if(format!=='midi')args.push('--channels',`${kind}-ch9`);
     const result=cli(...args);assert.equal(result.status,0,result.stderr);
     const output=readFileSync(out);
     if(format==='midi')assert.equal(output.subarray(0,4).toString(),'MThd');
     else {
      assert.match(output.toString(),new RegExp(`${kind.toUpperCase()} CH9`));
      assert.doesNotMatch(output.toString(),new RegExp(`${kind.toUpperCase()} CH1\\b`));
      assert.match(output.toString(),format==='musicxml'?/<step>A<\/step>/:/a'4/);
     }
    }
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 test(`${kind} CLI rejects dual/variant and mixed OPL sources without replacing output`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'tetorica-opl-invalid-'));
  try {
   const input=join(dir,'invalid.vgz'),out=join(dir,'existing'),sentinel=Buffer.from('keep original');
   for(const mode of ['dual','variant','mixed']) {
    const source=fixture(kind);
    if(mode==='mixed')source.writeUInt32LE(3579545,kind==='ym3526'?0x50:0x54);
    else source.writeUInt32LE((3579545|(mode==='dual'?0x40000000:0x80000000))>>>0,kind==='ym3526'?0x54:0x50);
    writeFileSync(input,gzipSync(source));
    for(const format of ['midi','musicxml','lilypond']) {
     writeFileSync(out,sentinel);
     const result=cli('export',input,'--format',format,'--output',out,'--force');
     assert.equal(result.status,1);assert.match(result.stderr,/Dual\/variant or mixed/);
     assert.deepEqual(readFileSync(out),sentinel);
     const fresh=join(dir,'new-output');
     assert.equal(cli('export',input,'--format',format,'--output',fresh).status,1);
     assert.equal(existsSync(fresh),false);
    }
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
}
