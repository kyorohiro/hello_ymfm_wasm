import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {exportSource, inspectSourceSupport} from '../cli/index.js';
import {snapshotSbiPatches, exportSbiZip} from '../docs/vgm_analyzer/sbi_export.js';

const main=fileURLToPath(new URL('../cli/main.js',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,[main,...args],{encoding:'utf8'});
function fixture(kind) {
  const [offset,opcode]=({ym3526:[0x54,0x5b],ym3812:[0x50,0x5a],y8950:[0x58,0x5c],ymf262:[0x5c,0x5e],ymf278b:[0x60,0xd0]})[kind];
  const fourOp=kind==='ymf262'||kind==='ymf278b';
  const writes=[...(fourOp?[[5,1,1],[4,1,1],[0x28,9]]:[]),[0x20,7],[0xb0,32]];
  const write=([r,v,p=0])=>kind==='ymf278b'?[opcode,p,r,v]:[opcode+p,r,v];
  const commands=[...writes.flatMap(write),0x61,0x44,0xac,...write([0x20,8]),0x61,0x44,0xac,0x66];
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);
  view.setUint32(offset,14318180,true);bytes.set(commands,256);return bytes;
}

for(const kind of ['ym3526','ym3812','y8950','ymf262','ymf278b']) test(`${kind}: CLI VGM/VGZ SBI and ZIP equal browser exports`,async()=>{
  const source=fixture(kind),dir=mkdtempSync(join(tmpdir(),'sbi-cli-'));
  try {
    for(const ext of ['vgm','vgz']) {
      const input=join(dir,'song.'+ext);writeFileSync(input,ext==='vgz'?gzipSync(source):source);
      for(const format of ['sbi','sbi-zip']) {
        const output=join(dir,ext+'.'+format);
        const args=['export',input,'--format',format,'--output',output,...(format==='sbi'?['--at','1','--channel','1']:[])];
        const result=cli(...args);assert.equal(result.status,0,result.stderr);
        const expected=format==='sbi'?snapshotSbiPatches(source,44100)[0].data:exportSbiZip(source).bytes;
        assert.deepEqual(readFileSync(output),Buffer.from(expected));
        assert.match(result.stderr,/Static melodic FM voices/);
        assert.equal(cli(...args).status,1,'existing output is protected');
        assert.deepEqual(readFileSync(output),Buffer.from(expected));
        assert.equal(cli(...args,'--force').status,0);
      }
    }
    const support=await inspectSourceSupport(source);
    assert.equal(support.exports.sbi.status,'available');
    assert.equal(support.exports['sbi-zip'].status,'available');
    const input=join(dir,'song.vgm');
    const report=cli('support',input,'--json');assert.equal(report.status,0,report.stderr);
    assert.equal(JSON.parse(report.stdout).exports.sbi.status,'available');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('SBI API requires time/channel and rejects unsupported snapshot channels/options',()=>{
  const source=fixture('ymf262');
  for(const atSeconds of [undefined,-1,NaN,Infinity,Number.MAX_VALUE,2.001])
    assert.throws(()=>exportSource(source,{format:'sbi',atSeconds,channel:1}),/time/i);
  for(const channel of [undefined,0,1.5,19,4])
    assert.throws(()=>exportSource(source,{format:'sbi',atSeconds:0,channel}),/channel/i);
  assert.throws(()=>exportSource(fixture('ym3812'),{format:'sbi',atSeconds:0,channel:10}),/channel/i);
  for(const extra of [{atSeconds:0},{channel:1}])
    assert.throws(()=>exportSource(source,{format:'sbi-zip',...extra}),/Time\/channel/);
  for(const atSeconds of [0,.999,1,2]) {
    const result=exportSource({bytes:source},{format:'sbi',atSeconds,channel:1});
    assert.equal(result.bytes.length,60);assert.equal(result.bytes[36],atSeconds<1?7:8);
    assert.equal(result.sample,Math.floor(atSeconds*44100));assert.equal(result.channel,1);
  }
});

test('CLI SBI failures neither create nor truncate output files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sbi-errors-'));
  try {
    const input=join(dir,'song.vgm'),output=join(dir,'voice.sbi');writeFileSync(input,fixture('ymf262'));
    const invalid=[['sbi'],['sbi','--at','0'],['sbi','--channel','1'],['sbi','--at','0','--channel','4'],
      ['sbi','--at','3','--channel','1'],['sbi-zip','--at','0']];
    for(const [format,...options] of invalid) {
      const result=cli('export',input,'--format',format,...options,'--output',output);
      assert.equal(result.status,1);assert.equal(existsSync(output),false);
    }
    writeFileSync(output,'keep');
    for(const [format,...options] of invalid) {
      assert.equal(cli('export',input,'--format',format,...options,'--output',output,'--force').status,1);
      assert.equal(readFileSync(output,'utf8'),'keep');
    }
    assert.match(cli('--help').stdout,/Snapshot formats sbi\/tfi/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
