import test from 'node:test';
import assert from 'node:assert/strict';
import {installPlaygroundPageLifecycle} from './playground_page_lifecycle.js';
test('history departure cuts output immediately; restore and Run wait for finalization',async()=>{
 const handlers={},calls=[];
 let finish;
 const closing=new Promise(resolve=>finish=resolve);
 const runtime={megaDrive:{audio:{masterOutputNode:{disconnect(){calls.push('disconnect');}}},
  audioContext:{state:'running',suspend(){calls.push('suspend');return Promise.resolve();}}},
  finalize(){calls.push('finalize');return closing;}};
 const lifecycle=installPlaygroundPageLifecycle({target:{addEventListener(k,v){handlers[k]=v;}},getRuntime:()=>runtime,
  onRestored(){calls.push('restored');},onError:assert.fail});
 handlers.pagehide({persisted:true});
 assert.deepEqual(calls,['disconnect','suspend','finalize']);
 handlers.pageshow({persisted:true});
 let runReady=false;lifecycle.beforeRun().then(()=>runReady=true);
 await Promise.resolve();assert.equal(runReady,false);assert.ok(!calls.includes('restored'));
 finish();await lifecycle.beforeRun();await Promise.resolve();
 assert.equal(runReady,true);assert.equal(calls.at(-1),'restored');
 handlers.pagehide({persisted:false});assert.equal(calls.filter(x=>x==='finalize').length,2);
});
