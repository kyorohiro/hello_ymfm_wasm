// Fake output nodes and a real register helper. These checks open no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2608Synth} from '../js/ym2608synth.js';
import {createFm2608CodeAudio} from './code_audio.js';

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return {promise, resolve};
}
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture({pendingFirstRack = false} = {}) {
  const context = {state:'running', currentTime:0, sampleRate:48000}, events = [], racks = [];
  function node(name) {
    return {name, context, gain:{value:1}, edges:new Set(),
      connect(target) { this.edges.add(target); },
      disconnect(target) { if (target) this.edges.delete(target); else this.edges.clear(); },
    };
  }
  const input = node('input'), fade = node('fade'), master = node('master');
  input.connect(fade); fade.connect(master); master.gain.value = .7;
  const chip = new YM2608Synth({transport:{write:(port, register, value) => events.push(['write', port, register, value]), reset() { events.push(['reset']); }}});
  events.length = 0;
  const engine = {context, codeInputNode:input, codeOutputNode:fade, codeFadeNode:fade, outputNode:master,
    getChip:() => chip,
    stopAll() { events.push(['stop']); chip.noteOff(0); },
  };
  const host = createFm2608CodeAudio({ensureReady:async () => {}, getAudio:() => engine,
    createFxRack:async () => {
      const task = deferred(), names = new Set();
      let chain = [];
      const rack = {node:node('fx' + racks.length), disposals:0,
        controller:{
          liveFx(name) { names.add(name); },
          removeLiveFx(name) { names.delete(name); },
          setChain(value) { chain = [...value]; },
          getChain:() => [...chain],
          clear() { chain = []; },
        },
        stop() { events.push(['fx-stop']); },
        dispose() { this.disposals++; this.node.disconnect(); },
      };
      racks.push({rack, task});
      if (!pendingFirstRack || racks.length > 1) task.resolve(rack);
      return task.promise;
    },
    createOutput:options => ({
      open() { options.getGain().gain.value = 1; },
      fadeOut() { events.push(['fade']); options.getGain().gain.value = 0; return Promise.resolve(); },
      dispose() { options.getGain().gain.value = 0; },
    }),
  });
  return {host, engine, events, racks, input, fade, master};
}

test('OPNA Code routes FX before the same Stop fade and Master, and keeps the borrowed chip alive', async () => {
  const f = fixture(), chip = await f.host.useSoundChip('ym2608');
  assert.equal(chip, await f.host.useSoundChip('ym2608'));
  chip.noteOn(0, 'C4');
  f.host.fx.liveFx('first', {});
  const rack = f.racks[0].rack;
  assert(f.input.edges.has(rack.node));
  assert(!f.input.edges.has(f.fade));
  assert(rack.node.edges.has(f.fade));
  assert.equal(f.master.gain.value, .7);
  f.host.fx.removeLiveFx('first');
  assert(f.input.edges.has(f.fade));
  f.host.fx.setChain([{}]);
  assert(f.input.edges.has(rack.node));
  f.host.fx.setChain([]);
  assert(f.input.edges.has(f.fade));
  await f.host.beforeStop();
  await f.host.stop();
  assert(f.events.findIndex(event => event[0] === 'fade') < f.events.findIndex(event => event[0] === 'stop'));
  assert(!f.events.some(event => event[0] === 'reset'));
  assert.equal(f.engine.context.state, 'running');
  assert.equal(rack.disposals, 1);
  assert.throws(() => chip.noteOn(0, 'E4'), {name:'AbortError'});
  f.host.open();
  const next = await f.host.useSoundChip('ym2608');
  next.noteOn(0, 'E4');
  await f.host.dispose();
});

test('a retired OPNA effect preparation cannot reset or reroute a newer Code session', async () => {
  const f = fixture({pendingFirstRack:true});
  const old = f.host.prepare(), rejected = assert.rejects(old, {name:'AbortError'});
  await turn();
  await f.host.stop();
  const fresh = await f.host.useSoundChip('ym2608');
  fresh.noteOn(0, 'C4');
  const stops = f.events.filter(event => event[0] === 'stop').length;
  f.racks[0].task.resolve(f.racks[0].rack);
  await rejected;
  assert.equal(f.racks[0].rack.disposals, 1);
  assert.equal(f.events.filter(event => event[0] === 'stop').length, stops);
  assert.equal(f.racks[1].rack.disposals, 0);
  assert(f.input.edges.has(f.fade));
  await f.host.dispose();
});
