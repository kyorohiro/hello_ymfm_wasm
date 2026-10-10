import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {shellError} from './playground_shell_diagnostics.js';
test('error stack frames retain source path and line; import fallback never overrides the actual frame',()=>{
 const e=new TypeError('broken');e.stack='TypeError: broken\n at go (tetorica-shell:/lib/a%20b.js:7:19)';e.virtualPath='/index.js';
 const detail=shellError(e,{path:'/other.js'});assert.equal(detail.path,'/lib/a b.js');assert.equal(detail.line,7);assert.equal(detail.column,19);assert.equal(detail.name,'TypeError');
 const syntax=new SyntaxError('bad token');syntax.stack='SyntaxError: bad token';syntax.virtualPath='/lib/syntax.js';const fallback=shellError(syntax);assert.equal(fallback.path,'/lib/syntax.js');assert.equal(fallback.line,null);
});
test('worker errors and unhandled rejections serialize structured details',()=>{
 const listeners=new Map(),messages=[];const source=readFileSync(new URL('./playground_shell_worker.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
 vm.runInNewContext(source,{self:{addEventListener:(name,fn)=>listeners.set(name,fn)},postMessage:data=>messages.push(data),shellError});
 listeners.get('unhandledrejection')({preventDefault(){},reason:'TypeError: rejected\n at run (tetorica-shell:/test.js:2:4)'});
 assert.equal(messages[0].type,'failed');assert.equal(messages[0].details.path,'/test.js');assert.equal(messages[0].details.line,2);assert.equal(messages[0].details.name,'TypeError');
 listeners.get('error')({preventDefault(){},error:new Error('late')});assert.equal(messages.length,1);
});
test('worker bounds producer messages for console floods and reports omitted output',()=>{
 const messages=[],ctx=vm.createContext({self:{addEventListener(){}},postMessage:data=>messages.push(data),shellError});const source=readFileSync(new URL('./playground_shell_worker.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');vm.runInContext(source,ctx);
 vm.runInContext('for(let i=0;i<10000;i++)shellConsole.log("x".repeat(200));shellConsole.error("y".repeat(10000));',ctx);
 const outputs=messages.filter(m=>m.type==='output');assert(outputs.length<=100);assert(outputs.filter(m=>m.level==='log').reduce((n,m)=>n+m.text.length,0)<=8000);assert(outputs.filter(m=>m.level==='error').reduce((n,m)=>n+m.text.length,0)<=8000);assert(messages.some(m=>m.type==='output-truncated'&&m.field==='stdout'));assert(messages.some(m=>m.type==='output-truncated'&&m.field==='stderr'));
});
