import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineAudioDecoder,normalizeLocalMediaUrl} from './audio_decode.js';

test('offline preparation is lazy, reuses its decoder and preserves detached input ownership',async t=>{
  const previous=globalThis.OfflineAudioContext,created=[];
  let rate=48000;
  globalThis.OfflineAudioContext=class {
    constructor(...options){created.push(options);}
    decodeAudioData(bytes,resolve) {
      structuredClone(bytes,{transfer:[bytes]});
      queueMicrotask(()=>resolve({decoded:true}));
    }
    startRendering(){assert.fail('Preparing a sample must not render audio');}
  };
  t.after(()=>{if(previous===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=previous;});
  const decode=createOfflineAudioDecoder({getSampleRate:()=>rate});assert.equal(created.length,0);
  const input=Uint8Array.of(0x66,0x4c,0x61,0x43);
  assert.deepEqual(await decode(input.buffer),{decoded:true});
  assert.deepEqual([...input],[0x66,0x4c,0x61,0x43]);
  await decode(input.buffer);assert.deepEqual(created,[[2,1,48000]]);
  rate=44100;await decode(input.buffer);assert.deepEqual(created.at(-1),[2,1,44100]);
});

test('sample aliases and same-origin restrictions are shared by Web Audio and Native',t=>{
  const previous=globalThis.location;
  globalThis.location={href:'https://example.test/playground/index.html?mode=genesis',origin:'https://example.test'};
  t.after(()=>{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;});
  assert.equal(normalizeLocalMediaUrl('sonic-pi/ambi-choir'),'https://example.test/playground/samples/sonic-pi/ambi_choir.flac');
  assert.equal(normalizeLocalMediaUrl('./samples/own.mp3'),'https://example.test/playground/samples/own.mp3');
  assert.equal(normalizeLocalMediaUrl('data:audio/flac;base64,AA=='),'data:audio/flac;base64,AA==');
  assert.equal(normalizeLocalMediaUrl('blob:https://example.test/123'),'blob:https://example.test/123');
  assert.throws(()=>normalizeLocalMediaUrl('https://elsewhere.test/sample.mp3'),/same-origin/);
});
