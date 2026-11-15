// SPDX-License-Identifier: BSD-3-Clause
// Exercise host bus mixing through the C ABI without opening an audio device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const options = {};
for (let index=2; index<process.argv.length; index++) {
  const name = process.argv[index];
  assert(['--wasm-dir','--legacy-dir','--out'].includes(name),'Unknown argument '+name);
  const value = process.argv[++index];
  assert(value && !value.startsWith('--'),name+' requires a path');
  options[name] = resolve(value);
}
assert(options['--wasm-dir'],'Use --wasm-dir with a compiled YM2608 WASM directory');

async function backend(directory) {
  const {default:factory} = await import(pathToFileURL(resolve(directory,'ym2608_wasm.js')).href);
  return factory({wasmBinary:await readFile(resolve(directory,'ym2608_wasm.wasm'))});
}
const module = await backend(options['--wasm-dir']);
const handle = module._ym2608_create();
assert(handle);
const write = (register,value,port=0) => {
  module._ym2608_write(handle,port*2,register);
  module._ym2608_write(handle,port*2+1,value);
};
const gains = (fm,ssg) => module._ym2608_set_output_gains(handle,fm,ssg);
const frames = 4096;
const left = module._malloc(frames*4), right = module._malloc(frames*4);
assert(left && right);
function render() {
  module._ym2608_generate(handle,left,right,frames);
  return [new Float32Array(module.HEAPF32.buffer,left,frames).slice(),
    new Float32Array(module.HEAPF32.buffer,right,frames).slice()];
}
function save() {
  const size = module._ym2608_save_state(handle,0), pointer = module._malloc(size);
  assert(pointer);
  try {
    assert.equal(module._ym2608_save_state(handle,pointer),size);
    return new Uint8Array(module.HEAPU8.buffer,pointer,size).slice();
  } finally {module._free(pointer);}
}
function load(bytes) {
  const pointer = module._malloc(bytes.length);
  assert(pointer);
  try {
    new Uint8Array(module.HEAPU8.buffer,pointer,bytes.length).set(bytes);
    return module._ym2608_load_state(handle,pointer,bytes.length);
  } finally {module._free(pointer);}
}
function configure() {
  write(0x29,0x9f);write(7,0x3e);write(0,119);write(1,0);write(8,10);
  for (const slot of [0,4,8,12]) {
    write(0x30+slot,1);write(0x40+slot,slot === 12 ? 24 : 127);
    write(0x50+slot,31);write(0x60+slot,0);write(0x70+slot,0);write(0x80+slot,15);
  }
  write(0xb0,7);write(0xb4,0xc0);write(0xa4,0x22);write(0xa0,0xa5);write(0x28,0x80);
}
const peak = pcm => Math.max(...pcm.map(channel => Math.max(...channel.map(Math.abs))));
const checks = [];
try {
  assert.equal(module._ym2608_set_output_gains(0,1,1),0);
  configure();
  const initial = save();
  const renderAt = (fm,ssg) => {assert.equal(load(initial),1);assert.equal(gains(fm,ssg),1);return render();};
  const unscaled = renderAt(1,1), fm = renderAt(1,0), ssg = renderAt(0,1);
  assert(peak(fm)>.001 && peak(ssg)>.001);
  for (const [fmGain,ssgGain] of [[.6,.75],[0,0],[2.5,0],[0,1.6015625]]) {
    const actual = renderAt(fmGain,ssgGain);
    for (let channel=0; channel<2; channel++) for (let index=0; index<frames; index++) {
      const expected = Math.max(-1,Math.min(32767/32768,fm[channel][index]*fmGain+ssg[channel][index]*ssgGain));
      assert(Math.abs(actual[channel][index]-expected)<2e-7,'Independent bus scaling');
    }
  }
  checks.push('independent-FM-side-and-SSG-gains-before-final-clipping');
  const loud = renderAt(1024,1024);
  assert(loud.every(channel => channel.every(Number.isFinite)));
  assert(peak(loud)<=1);
  checks.push('bounded-finite-output-at-the-largest-accepted-gains');

  assert.equal(load(initial),1);assert.equal(gains(.6,.75),1);
  const before = save();
  for (const pair of [[NaN,1],[1,Infinity],[-1,1],[1,1024.5]]) {
    assert.equal(gains(...pair),0);
    assert.deepEqual(save(),before,'Invalid gains leave both values and chip state intact');
  }
  assert.equal(load(initial),1);assert.equal(gains(.6,.75),1);
  const gainState = save(), expected = render();
  assert.equal(gains(1,1),1);render();
  assert.equal(load(gainState),1);assert.deepEqual(render(),expected);
  const badState = gainState.slice();
  new DataView(badState.buffer).setFloat32(badState.length-4,NaN,true);
  const validBefore = save();
  assert.equal(load(badState),0);assert.deepEqual(save(),validBefore);
  checks.push('atomic-gain-validation-and-checkpoint-restore');

  assert.equal(gains(.6,.75),1);module._ym2608_reset(handle);configure();
  const afterReset = save(), view = new DataView(afterReset.buffer);
  assert.equal(view.getFloat32(afterReset.length-8,true),Math.fround(.6));
  assert.equal(view.getFloat32(afterReset.length-4,true),.75);
  checks.push('host-gains-survive-chip-reset');

  if (options['--legacy-dir']) {
    const legacy = await backend(options['--legacy-dir']);
    const original = legacy._ym2608_create();
    const oldLeft = legacy._malloc(frames*4), oldRight = legacy._malloc(frames*4);
    try {
      assert.equal(load(initial),1);assert.equal(gains(1,1),1);
      // Default-gain checkpoint is the previous chip layout followed by two
      // host floats. Only the historical chip portion is sent to that build.
      const bytes = initial.subarray(0,initial.length-8), pointer = legacy._malloc(bytes.length);
      try {
        new Uint8Array(legacy.HEAPU8.buffer,pointer,bytes.length).set(bytes);
        assert.equal(legacy._ym2608_load_state(original,pointer,bytes.length),1);
      } finally {legacy._free(pointer);}
      legacy._ym2608_generate(original,oldLeft,oldRight,frames);
      assert.deepEqual(new Float32Array(legacy.HEAPF32.buffer,oldLeft,frames),unscaled[0]);
      assert.deepEqual(new Float32Array(legacy.HEAPF32.buffer,oldRight,frames),unscaled[1]);
      checks.push('default-gains-retain-legacy-PCM-bit-for-bit');
    } finally {
      legacy._free(oldLeft);legacy._free(oldRight);legacy._ym2608_destroy(original);
    }
  }
  const report = {passed:true,deviceOpened:false,checks,wasmDirectory:options['--wasm-dir']};
  if (options['--out']) {
    await mkdir(dirname(options['--out']),{recursive:true});
    await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify(report,null,2));
} finally {
  module._free(left);module._free(right);module._ym2608_destroy(handle);
}
