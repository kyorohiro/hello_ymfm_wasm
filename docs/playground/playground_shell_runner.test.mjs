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
