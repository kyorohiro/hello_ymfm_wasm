import test from 'node:test';
import assert from 'node:assert/strict';
import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js';

function context() {
  const context = {createGain: () => node()};
  function node() {
    return {context, gain: {value: 1}, connections: new Set(),
      connect(target) {this.connections.add(target);},
      disconnect(target) {if (target) this.connections.delete(target); else this.connections.clear();}};
  }
  context.destination = node();
  return context;
}

test('output observation survives FX and destination changes without replacing audible routing', () => {
  const ctx = context(), audio = new TetoricaAudioRuntime({audioContext: ctx});
  audio.ensureRouting(ctx);
  const monitor = ctx.createGain(), release = audio.connectOutputMonitor(monitor);
  const fx = {input: ctx.createGain(), output: ctx.createGain(), disconnect() {this.output.disconnect();}};
  audio.setFXChain([fx]);
  assert.ok(audio.masterOutputNode.connections.has(ctx.destination));
  assert.ok(audio.masterOutputNode.connections.has(monitor));
  assert.ok(fx.output.connections.has(audio.masterOutputNode));
  const destination = ctx.createGain();
  audio.connectOutput(destination);
  assert.deepEqual(audio.masterOutputNode.connections, new Set([destination, monitor]));
  release(); release();
  assert.deepEqual(audio.masterOutputNode.connections, new Set([destination]));
  assert.equal(audio.outputMonitors.size, 0);
});

test('closing removes observers and rejects nodes from another context', () => {
  const ctx = context(), audio = new TetoricaAudioRuntime({audioContext: ctx});
  audio.ensureRouting(ctx);
  assert.throws(() => audio.connectOutputMonitor(context().createGain()), /same AudioContext/);
  const monitor = ctx.createGain();
  audio.connectOutputMonitor(monitor);
  audio.closeMedia();
  audio.rebuildFXChain();
  assert.deepEqual(audio.masterOutputNode.connections, new Set([ctx.destination]));
  assert.equal(audio.outputMonitors.size, 0);
});
