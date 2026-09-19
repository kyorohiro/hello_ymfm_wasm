import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readSource,listSourceSamples} from '../cli/index.js';
import {extractSamples} from '../docs/vgm_analyzer/sample_explorer.js';
const fixture=name=>new URL('./fixtures/'+name+'.vgz',import.meta.url);
test('Sample listing matches Browser definitions and events without binary payloads',async()=>{
 for(const name of ['ym2610-adpcm-a','ym2610-adpcm-b','ym2608-adpcm','pwm-all']){
  const source=await readSource(fixture(name)),browser=await extractSamples(source),list=await listSourceSamples(source);
  if(name!=='ym2608-adpcm')assert(browser.samples.length>0);assert.equal(list.samples.length,browser.samples.length);
  assert.deepEqual(list.events,browser.events);assert.equal(list.timebase,44100);
  for(const [i,s] of list.samples.entries()){
   assert.equal(s.id,browser.samples[i].id);assert.equal(s.size,browser.samples[i].size);
   assert.equal(s.exportable,Boolean(browser.samples[i].data));
   for(const key of ['data','times','registers'])assert.equal(key in s,false);
  }
  const cli=spawnSync(process.execPath,['cli/main.js','samples',fixture(name).pathname,'--json'],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),list);
 }
});
test('Sample listing handles empty tracks, cancellation and command option errors',async()=>{
 const source=await readSource(fixture('psg-tone'));
 assert.deepEqual((await listSourceSamples(source)).samples,[]);
 const controller=new AbortController();controller.abort();
 await assert.rejects(listSourceSamples(source,{signal:controller.signal}),{name:'AbortError'});
 const cli=spawnSync(process.execPath,['cli/main.js','samples',fixture('psg-tone').pathname,'--output','ignored'],{encoding:'utf8'});
 assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.match(cli.stderr,/not valid/);
});
