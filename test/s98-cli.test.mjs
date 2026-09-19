import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {readSourceDocument,decodeSource,decodeSourceDocument,analyzeSource,exportSource,renderSource} from '../cli/index.js';
import {convertS98ToVgm} from '../docs/js/s98_file.js';
const fixture=name=>new URL(`./fixtures/s98-${name}.s98`,import.meta.url);
const cli=(...args)=>spawnSync(process.execPath,['cli/main.js',...args],{encoding:'utf8'});
test('S98 normalization, original metadata, exports and PCM match Browser for all supported devices',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'s98-cli-'));
  try{for(const name of ['ym2203','ym2608','ym2612']){
    const input=fixture(name),raw=readFileSync(input),browser=convertS98ToVgm(raw),doc=await readSourceDocument(input);
    assert.deepEqual(doc.bytes,new Uint8Array(browser.buffer));assert.deepEqual(doc.sourceHeader,browser.sourceHeader);
    assert.match(doc.sourceHeader.tag,/自作 tone/);assert.equal(doc.sourceHeader.numerator,1);
    assert.deepEqual(await decodeSource(raw),doc.bytes);
    const wrapped=new Uint8Array(raw.length+10);wrapped.set(raw,5);
    assert.deepEqual(await decodeSourceDocument(wrapped.subarray(5,-5)),doc);
    const summary=analyzeSource(doc);assert.equal(summary.sourceHeader.format,'S983');assert(summary.header.loopSamples>0);
    const result=cli('analyze',fileURLToPath(input),'--json');assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),summary);
    for(const format of ['midi','musicxml','lilypond','mucom','opnavoid']){
      const expected=exportSource(doc.bytes,{format,bpm:120});assert.deepEqual(exportSource(doc,{format,bpm:120}),expected);
      const out=join(dir,name+'.'+format),r=cli('export',fileURLToPath(input),'--format',format,'--bpm','120','--output',out);
      assert.equal(r.status,0,r.stderr);
      const cliExpected=exportSource(doc.bytes,{format,bpm:120,fileName:'s98-'+name+'.s98'});
      assert.deepEqual(readFileSync(out),Buffer.from(cliExpected.bytes??cliExpected.text));
    }
    const wav=await renderSource(doc,{maxSeconds:.03});assert.deepEqual(wav,await renderSource(doc.bytes,{maxSeconds:.03}));assert(wav.bytes.subarray(44).some(v=>v!==0));
    const out=join(dir,name+'.wav'),r=cli('render',fileURLToPath(input),'--max-seconds','.03','--output',out);
    assert.equal(r.status,0,r.stderr);assert.deepEqual(readFileSync(out),Buffer.from(wav.bytes));
  }}finally{rmSync(dir,{recursive:true,force:true});}
});
test('S98 invalid headers, unsupported devices, ports, compression and incomplete streams reject',async()=>{
  const raw=readFileSync(fixture('ym2203'));
  for(const [offset,value] of [[0x0c,1],[0x14,1],[0x20,99],[0x1c,2],[0x28,1],[0x18,49]]){
    const bad=Uint8Array.from(raw);new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(decodeSourceDocument(bad),/S98:/);
  }
  for(const bad of [raw.subarray(0,20),Uint8Array.from([83,57,56,57]),(()=>{const b=Uint8Array.from(raw);b[48]=1;return b;})()])await assert.rejects(decodeSource(bad),/S98:/);
  const end=raw.readUInt32LE(0x10)-1,bad=Uint8Array.from(raw);bad[end]=0xff;
  await assert.rejects(decodeSourceDocument(bad),/missing end/);
});
