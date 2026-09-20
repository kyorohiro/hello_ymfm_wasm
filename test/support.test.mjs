import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readSource,inspectSourceSupport,exportFormats} from '../cli/index.js';
const fixture=new URL('./fixtures/nes-tone.vgz',import.meta.url);
test('support JSON matches shared API and separates NES score and voice exports',async()=>{
  const source=await readSource(fixture);
  const result=await inspectSourceSupport(source);
  assert.equal(result.declaredChips[0].id,'nesApu');
  assert.equal(result.render.engine,'nes');
  assert.equal(result.samples.status,'no-data');
  assert.equal(result.render.muteIds.length,5);
  assert.equal(result.exports.musicxml.status,'available');
  assert.equal(result.exports.tfi.status,'unavailable');
  assert(result.exports.tfi.reason);
  assert.deepEqual(Object.keys(result.exports),exportFormats);
  const cli=spawnSync(process.execPath,['cli/main.js','support',fixture.pathname,'--json'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout),result);
});
test('unsupported render does not suppress analysis; PAL and dual NES are rejected',async()=>{
  for(const clock of [1662607,0x401b4f4d]){
    const bytes=new Uint8Array(readFileSync(new URL('./fixtures/nes-tone.vgm',import.meta.url)));
    new DataView(bytes.buffer).setUint32(0x84,clock,true);
    const result=await inspectSourceSupport(bytes);
    assert.equal(result.analysis.status,'available');
    assert.equal(result.render.status,'unsupported');
    assert.match(result.render.reason,/NTSC|Dual/);
  }
});
test('support rejects invalid options rather than reporting success',()=>{
  const result=spawnSync(process.execPath,['cli/main.js','support',fixture.pathname,'--output','unused'],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/not valid/);
});

test('support reports external ROM requirements without initializing WASM',async()=>{
  const source=await readSource(new URL('./fixtures/ym2608-rhythm.vgz',import.meta.url));
  const report=await inspectSourceSupport(source);
  assert.equal(report.render.status,'requires-resources');
  assert.deepEqual(report.render.requiredRoms,['ym2608AdpcmA']);
  await assert.rejects(inspectSourceSupport(new Uint8Array([1,2,3])));
});
