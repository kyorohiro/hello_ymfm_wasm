import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLilyPond } from './lilypond_preview.js';
function mock() {
  const handlers = {};
  return { handlers, terminated: 0, addEventListener(t, fn) { handlers[t] = fn; },
    postMessage(data) { this.sent = data; }, terminate() { this.terminated++; },
    message(data) { handlers.message({ data: { requestId: 1, ...data } }); } };
}
test('render returns SVG pages and diagnostics, ignores unrelated requests and releases worker', async () => {
  const worker = mock(), progress = [];
  const promise = renderLilyPond('score', { workerFactory: () => worker, onProgress: p => progress.push(p) });
  assert.deepEqual(worker.sent, {type:'render',requestId:1,source:'score'});
  worker.message({type:'error',requestId:2,message:'unrelated'});
  worker.message({type:'progress',message:'Engraving'});
  worker.message({type:'diagnostic',message:'warning'});
  worker.message({type:'result',exitCode:0,svgs:['<svg/>'],files:['score.svg']});
  assert.deepEqual(await promise, {svgs:['<svg/>'],files:['score.svg'],diagnostics:['warning']});
  assert.deepEqual(progress, ['Engraving']); assert.equal(worker.terminated, 1);
});
test('compile failures, missing SVG and worker errors reject and release worker', async () => {
  for (const data of [{type:'error',message:'bad input'},{type:'result',exitCode:1,svgs:[]},{type:'result',exitCode:0,svgs:[]}]) {
    const worker=mock(); const promise=renderLilyPond('bad',{workerFactory:()=>worker});
    worker.message(data); await assert.rejects(promise); assert.equal(worker.terminated,1);
  }
  const worker=mock(); const promise=renderLilyPond('',{workerFactory:()=>worker});
  worker.handlers.error({message:'Load failed'}); await assert.rejects(promise,/Load failed/); assert.equal(worker.terminated,1);
});
test('cancel, pre-abort, timeout and failed postMessage release resources', async () => {
  const controller=new AbortController(), worker=mock();
  const promise=renderLilyPond('',{signal:controller.signal,workerFactory:()=>worker});
  controller.abort(); await assert.rejects(promise,/cancelled/); assert.equal(worker.terminated,1);
  await assert.rejects(renderLilyPond('',{signal:controller.signal,workerFactory:()=>{throw Error('must not create');}}),/cancelled/);
  const timed=mock(); await assert.rejects(renderLilyPond('',{workerFactory:()=>timed,timeoutMs:1}),/timed out/); assert.equal(timed.terminated,1);
  const broken=mock(); broken.postMessage=()=>{throw Error('post failed')};
  await assert.rejects(renderLilyPond('',{workerFactory:()=>broken}),/post failed/); assert.equal(broken.terminated,1);
});

test('diagnostics are reported before result; message decoding failure terminates rendering', async () => {
  const worker=mock(), seen=[];
  const promise=renderLilyPond('',{workerFactory:()=>worker,onDiagnostic:text=>seen.push(text)});
  worker.message({type:'diagnostic',message:'Parsing...'});
  assert.deepEqual(seen,['Parsing...']); assert.equal(worker.terminated,0);
  worker.handlers.messageerror();
  await assert.rejects(promise,/receive/); assert.equal(worker.terminated,1);
});

test('stdio position probes retain NOTCAPABLE; regular file tells still reach WASI', async () => {
  const {withQuietStdioTell}=await import('./vendor/lilypond/wasi_stdio.js');
  const calls=[];const tell=(...args)=>{calls.push(args);return 0;};
  const original={wasi_snapshot_preview1:{fd_tell:tell,fd_write:()=>0}};
  const adapted=withQuietStdioTell(original);
  for(const fd of [0,1,2]) assert.equal(adapted.wasi_snapshot_preview1.fd_tell(fd,128),76);
  assert.deepEqual(calls,[]);
  assert.equal(adapted.wasi_snapshot_preview1.fd_tell(3,128),0);
  assert.deepEqual(calls,[[3,128]]);
  assert.equal(original.wasi_snapshot_preview1.fd_tell,tell);
  assert.equal(adapted.wasi_snapshot_preview1.fd_write,original.wasi_snapshot_preview1.fd_write);
});

test('worker stack errors retain the trace in diagnostics', async () => {
  const worker=mock(), diagnostics=[];
  const promise=renderLilyPond('',{workerFactory:()=>worker,onDiagnostic:line=>diagnostics.push(line)});
  worker.message({type:'error',message:'Maximum call stack size exceeded',stack:'RangeError: Maximum call stack size exceeded\n at wasm-function[42]'});
  await assert.rejects(promise,/Maximum call stack/);
  assert.match(diagnostics[0],/wasm-function\[42\]/); assert.equal(worker.terminated,1);
});
