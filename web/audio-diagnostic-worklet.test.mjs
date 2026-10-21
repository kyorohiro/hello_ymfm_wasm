import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('./audio-diagnostic-worklet.js', import.meta.url), 'utf8');
function capture(capacity = 5) {
  let Processor, wall = 1000, pcmAllocations = 0;
  const messages = [];
  const Float32 = new Proxy(Float32Array, {construct(target, args) {
    pcmAllocations++; return Reflect.construct(target, args);
  }});
  const scope = vm.createContext({Float32Array:Float32, ArrayBuffer, sampleRate:48000, currentFrame:100,
    Date:{now:() => wall}, AudioWorkletProcessor:class {
      constructor() { this.port = {postMessage:(data, transfer = []) => messages.push(structuredClone(data, {transfer}))}; }
    }, registerProcessor:(_name, type) => { Processor = type; }});
  vm.runInContext(source, scope);
  const processor = new Processor();
  const send = data => processor.port.onmessage({data});
  const arm = (id = 1, size = capacity) => {
    const channels = Array.from({length:4}, () => new Float32Array(size));
    send(structuredClone({type:'arm', id, channels}, {transfer:channels.map(channel => channel.buffer)}));
    assert.ok(channels.every(channel => channel.byteLength === 0), 'Main transfers ownership once');
  };
  const process = (inputs, length = 3) => {
    const output = [new Float32Array(length).fill(9), new Float32Array(length).fill(9)];
    processor.process(inputs, [output]);
    assert.ok(output.every(channel => channel.every(value => value === 0)), 'observation branch stays silent');
    scope.currentFrame += length;
    wall += 3;
  };
  return {processor, messages, send, arm, process, scope, setWall:value => {wall = value;}, allocations:() => pcmAllocations};
}

test('bounded capture aligns both stereo stages, preserves samples and transfers only once at completion', () => {
  const c = capture();
  const block = [[Float32Array.of(1, 2, 3), Float32Array.of(-1, -2, -3)],
    [Float32Array.of(.25, NaN, Infinity), Float32Array.of(-.25, -Infinity, -0)]];
  const unchanged = structuredClone(block);
  c.process(block);
  assert.equal(c.messages.length, 0);
  c.arm();
  c.process(block);
  assert.equal(c.messages.length, 1, 'no PCM or statistics messages per render quantum');
  c.process([[Float32Array.of(4, 5, 6), Float32Array.of(-4, -5, -6)],
    [Float32Array.of(.5, .75, 1), Float32Array.of(-.5, -.75, -1)]]);
  assert.equal(c.messages.length, 2);
  const result = c.messages[1];
  assert.equal(result.type, 'result'); assert.equal(result.reason, 'complete');
  assert.equal(result.frames, 5); assert.equal(result.blocks, 2);
  assert.equal(result.firstFrame, 103); assert.equal(result.lastFrame, 108);
  assert.equal(result.frameGaps, 0);
  assert.deepEqual([...result.channels[0]], [1, 2, 3, 4, 5]);
  assert.deepEqual([...result.channels[1]], [-1, -2, -3, -4, -5]);
  assert.deepEqual([...result.channels[2]], [.25, NaN, Infinity, .5, .75]);
  assert.deepEqual([...result.channels[3]], [-.25, -Infinity, -0, -.5, -.75]);
  assert.deepEqual(block, unchanged, 'diagnostics never modifies its input');
  assert.equal(c.processor.channels, null, 'completed buffers are no longer retained in the processor');
  c.process(block); c.send({type:'stop', id:1});
  assert.equal(c.messages.length, 2, 'completion cannot send detached buffers a second time');
  assert.equal(c.allocations(), 0, 'processor uses the Main-allocated PCM storage');
});

test('early Stop, cancellation and re-arming keep independent results and reject stale commands', () => {
  const c = capture(32), input = [[new Float32Array(3).fill(.5)], [new Float32Array(3).fill(.25)]];
  c.arm(); c.process(input); c.send({type:'stop', id:1});
  const first = c.messages.at(-1);
  assert.equal(first.reason, 'stopped'); assert.equal(first.frames, 3);
  assert.equal(first.channels[0].length, 32, 'only the frame count selects the valid prefix');
  assert.deepEqual([...first.channels[1].slice(0, 3)], [.5, .5, .5], 'mono input is duplicated');
  c.arm(2); c.send({type:'stop', id:1}); c.process(input);
  assert.equal(c.processor.frames, 3);
  c.send({type:'cancel', id:2}); c.process(input);
  assert.equal(c.processor.channels, null);
  assert.equal(c.messages.length, 3, 'cancel releases storage without returning a partial capture');
  c.arm(3); c.send({type:'stop', id:3});
  assert.equal(c.messages.at(-1).frames, 0);
  assert.equal(c.messages.at(-1).firstFrame, null);
  assert.deepEqual(first.missingInputFrames, [0, 0], 'later captures cannot alter an earlier result');
});

test('missing input and frame/clock discontinuities are reported without inventing samples or device underruns', () => {
  const c = capture(16);
  c.arm(); c.process([[], [Float32Array.of(1, 2)]]);
  c.scope.currentFrame += 128;
  c.setWall(980); c.process([[Float32Array.of(4, 5, 6)], []]);
  c.send({type:'stop', id:1});
  const result = c.messages.at(-1);
  assert.equal(result.frameGaps, 1); assert.ok(result.clockBacksteps > 0);
  assert.deepEqual(result.missingInputFrames, [3, 4]);
  assert.deepEqual([...result.channels[0].slice(0, 6)], [0, 0, 0, 4, 5, 6]);
  assert.deepEqual([...result.channels[2].slice(0, 6)], [1, 2, 0, 0, 0, 0]);
});

test('invalid or aliased storage is rejected and cannot replace an active capture', () => {
  const c = capture(8), shared = new Float32Array(8);
  c.send({type:'arm', id:1, channels:[shared, shared, shared, shared]});
  assert.equal(c.messages.at(-1).type, 'error'); assert.equal(c.processor.channels, null);
  const tooLong = new Float32Array(0);
  Object.defineProperty(tooLong, 'length', {value:2 ** 21 + 1});
  c.send({type:'arm', id:1, channels:[tooLong, tooLong, tooLong, tooLong]});
  assert.match(c.messages.at(-1).error, /capacity/);
  c.arm(2);
  c.send({type:'arm', id:3, channels:Array.from({length:4}, () => new Float32Array(8))});
  assert.equal(c.messages.at(-1).type, 'error'); assert.equal(c.processor.id, 2);
  c.process([[shared], [shared]]); c.send({type:'stop', id:2});
  assert.equal(c.messages.at(-1).id, 2); assert.equal(c.messages.at(-1).frames, 3);
});
