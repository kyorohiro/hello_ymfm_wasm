import test from 'node:test';
import assert from 'node:assert/strict';
import {createShell,createVirtualFileSystem} from '../js/tetorica_virtual_files/index.js';
import {registerShellCheck} from './playground_shell_check.js';
test('syntax check returns located JSON diagnostics and disposes temporary models without executing code',async()=>{
 const fs=createVirtualFileSystem([{path:'/ok.js',data:'globalThis.bad = true;'},{path:'/bad.js',data:'const x = 1;\nconst broken = ;'}]),shell=createShell({fs});let disposed=0;const sources=new Map();
 const monaco={Uri:{parse:value=>({toString:()=>value})},editor:{createModel(data,lang,uri){sources.set(uri.toString(),data);return {dispose(){sources.delete(uri.toString());disposed++;}};}},languages:{typescript:{getJavaScriptWorker:async()=>async uri=>({getSyntacticDiagnostics:async path=>sources.get(path).includes('broken')?[{category:1,start:13,code:1109,messageText:{messageText:'Expression expected',next:[]}}]:[]})}}};
 const before=fs.snapshot();registerShellCheck(shell,{getMonaco:()=>monaco});const r=await shell.execute('check --json /');assert.equal(r.code,1);const result=JSON.parse(r.stdout);assert.equal(result.files,2);assert.equal(result.diagnostics[0].path,'/bad.js');assert.equal(result.diagnostics[0].line,2);assert.equal(result.diagnostics[0].column,1);assert.equal(disposed,2);assert.equal(sources.size,0);assert.equal(globalThis.bad,undefined);assert.deepEqual(fs.snapshot(),before);
 assert.equal((await shell.execute('check /ok.js')).code,0);assert.match((await shell.execute('help check')).stdout,/--json/);
});
test('missing checker and binary files fail clearly',async()=>{
 const fs=createVirtualFileSystem([{path:'/index.js',data:'ok'}]);fs.writeBinary('/bad.js',new Uint8Array([255]));const shell=createShell({fs});registerShellCheck(shell,{getMonaco:()=>null});assert.match((await shell.execute('check /index.js')).stderr,/requires the Monaco/);assert.match((await shell.execute('check /bad.js')).stderr,/requires text/);
});
