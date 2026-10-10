import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem,createShell} from '../js/tetorica_virtual_files/index.js';
import {createShellScriptRunner} from './playground_shell_runner.js';

function setup(){
  const fs=createVirtualFileSystem([{path:'/index.js',data:'console.log(1)'}]);
  const workers=[];
  const runner=createShellScriptRunner({fs,workerFactory(){
    const listeners=new Map();
    const worker={messages:[],terminated:false,addEventListener(name,fn){listeners.set(name,fn);},
      postMessage(data){this.messages.push(data);},terminate(){this.terminated=true;},
      emit(data){return listeners.get('message')({data});}};
    workers.push(worker);return worker;
  }});
  const shell=createShell({fs});shell.register('js',context=>runner.run(context));
  return {fs,shell,runner,workers};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('stopped workers cannot issue delayed writes and the next command runs',async()=>{
  const {fs,shell,runner,workers}=setup();const result=shell.execute('js /index.js');await tick();
  runner.stop('Project changed');assert.equal((await result).code,130);
  await workers[0].emit({type:'rpc',id:1,method:'fs.writeText',args:['/late.js','bad']});
  assert.equal(workers[0].terminated,true);assert.equal(fs.has('/late.js'),false);
  assert.equal((await shell.execute('echo ready')).stdout,'ready\n');
});
test('a nested command reply arriving after cancellation is discarded',async()=>{
  const {fs,shell,runner,workers}=setup();let resolve;
  shell.register('wait',()=>new Promise(done=>resolve=done));
  const run=shell.execute('js /index.js');await tick();
  const request=workers[0].emit({type:'rpc',id:2,method:'execute',args:[['wait']]});await tick();
  runner.stop();await run;resolve('old result');await request;
  assert.equal(workers[0].messages.some(message=>message.id===2),false);
  assert.equal(fs.get('/index.js').data,'console.log(1)');
});
test('JSON runs return leveled console events and located errors without streaming duplicate output',async()=>{
 const {shell,workers,runner}=setup();const run=shell.execute('js --json /index.js argument');await tick();
 assert.deepEqual(workers[0].messages[0].args,['argument']);
 await workers[0].emit({type:'output',level:'log',text:'starting\n'});await workers[0].emit({type:'output',level:'warn',text:'warning\n'});
 await workers[0].emit({type:'failed',error:'TypeError: broken\n    at fail (tetorica-shell:/lib/a.js:3:7)'});
 const result=await run;assert.equal(result.code,1);assert.equal(result.stderr,'');const report=JSON.parse(result.stdout);
 assert.equal(report.path,'/index.js');assert.equal(report.status,'failed');assert.equal(report.error.name,'TypeError');assert.equal(report.error.path,'/lib/a.js');assert.equal(report.error.line,3);assert.equal(report.error.column,7);assert.deepEqual(report.console.map(e=>e.level),['log','warn']);assert.match(report.stdout,/starting/);assert.match(report.stderr,/broken/);assert(report.durationMs>=0);
 const saved=runner.result(report.id);assert.deepEqual(saved,report);saved.console[0].text='mutated';assert.equal(runner.result().console[0].text,'starting\n');
});
test('legacy output remains text, successful console.error does not fail and reports survive cancellation',async()=>{
 const {shell,workers,runner}=setup();const run=shell.execute('js /index.js');await tick();await workers[0].emit({type:'output',level:'error',text:'console only\n'});await workers[0].emit({type:'done'});
 assert.deepEqual(await run,{code:0,stdout:'',stderr:'console only\n'});assert.equal(runner.result().code,0);assert.equal(runner.result().error,null);
 const controller=new AbortController();const waiting=shell.execute('js --json /index.js',{signal:controller.signal});await tick();await workers[1].emit({type:'output',level:'info',text:'before stop\n'});controller.abort();assert.equal((await waiting).code,130);
 const report=runner.result();assert.equal(report.status,'cancelled');assert.match(report.stdout,/before stop/);assert.equal(workers[1].terminated,true);runner.clearResults();assert.throws(()=>runner.result(),/not found/);
});
test('log floods are bounded in returned JSON and stored history is limited to ten runs',async()=>{
 const {shell,workers,runner}=setup();
 for(let i=0;i<11;i++){const run=shell.execute('js --json /index.js');await tick();if(i===0){for(let n=0;n<120;n++)await workers[i].emit({type:'output',level:'debug',text:'\\'.repeat(5000)});}await workers[i].emit({type:'done'});const result=await run;assert(result.stdout.length<=32001);const report=JSON.parse(result.stdout);if(i===0){assert(report.truncated.stdout);assert(report.truncated.console);assert(report.truncated.report);}}
 assert.throws(()=>runner.result(1),/not found/);assert.equal(runner.result(2).id,2);assert.equal(runner.result().id,11);
});
test('latest result stays readable while a newer run is in progress',async()=>{
 const {shell,workers,runner}=setup();const first=shell.execute('js /index.js');await tick();await workers[0].emit({type:'done'});await first;
 const second=shell.execute('js /index.js');await tick();assert.equal(runner.result().id,1);runner.stop();await second;assert.equal(runner.result().id,2);
});
test('worker output limits are preserved in the stored report',async()=>{
 const {shell,workers}=setup();const run=shell.execute('js --json /index.js');await tick();await workers[0].emit({type:'output-truncated',field:'stdout'});await workers[0].emit({type:'done'});const report=JSON.parse((await run).stdout);assert(report.truncated.stdout);assert(report.truncated.console);
});
