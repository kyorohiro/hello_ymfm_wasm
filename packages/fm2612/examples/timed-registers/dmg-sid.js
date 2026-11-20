// SPDX-License-Identifier: BSD-3-Clause
// Shared browser clients, not the separate Synth-app borrowed-instrument facade.
import {createGameboyAudio} from 'tetorica-fm2612/playground_gameboy_audio.js';
import {createGameboyClient} from 'tetorica-fm2612/playground_gameboy.js';
import {createSidAudio} from 'tetorica-fm2612/playground_sid_audio.js';
import {createSidClient} from 'tetorica-fm2612/playground_sid.js';

/** Call from a user gesture. This function owns its context, endpoint and client. */
export async function startDmgSidTimedExample(mode = 'gameboy') {
  if (!['gameboy', '6581', '8580'].includes(mode)) throw new RangeError('Choose gameboy, 6581 or 8580');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw Error('This example needs Web Audio and AudioWorklet');
  const audioContext = new Context(), output = audioContext.createGain();
  output.gain.value = .2; output.connect(audioContext.destination);
  let endpoint, client;
  async function close() {
    try { await client?.dispose(); }
    finally {
      endpoint?.dispose(); output.disconnect();
      if (audioContext.state !== 'closed') await audioContext.close();
    }
  }
  const name = 'dmg-sid-phrase';
  try {
    // Resume in the gesture before awaiting files. The helpers create the real
    // Worklet and acknowledged port; a client alone does not create audio.
    await audioContext.resume();
    endpoint = mode === 'gameboy' ? await createGameboyAudio(audioContext, output)
      : await createSidAudio(audioContext, output, {model:mode});
    client = mode === 'gameboy' ? createGameboyClient(endpoint.port)
      : createSidClient(endpoint.port, endpoint);
    client.initialize();
    const operations = mode === 'gameboy' ? client.build(b => {
      b.atSample(0).pulse.setDuty(0, .25);
      b.pulse.setEnvelope(0, {volume:9, direction:'down', period:0});
      b.pulse.noteOn(0, 'E3');
      b.atSample(4410).pulse.setDuty(0, .5);
      b.atSeconds(.22).pulse.keyOff(0);
      b.atSeconds(.3).pulse.noteOn(0, 'G3');
      b.atSeconds(.52).pulse.keyOff(0);
    }) : client.build(b => {
      b.atSample(0).setVoice(0, {waveform:'pulse', pulseWidth:1024,
        attack:0, decay:4, sustain:10, release:5});
      b.setFilter({mode:'lowpass', routing:1, cutoff:300, resonance:4, volume:8});
      b.noteOn(0, 'E3');
      b.atSeconds(.15).setVoice(0, {pulseWidth:3072});
      b.setFilter({cutoff:700});
      b.atSeconds(.3).noteOff(0);
      b.atSeconds(.4).noteOn(0, 'G3');
      b.atSeconds(.65).noteOff(0);
    });

    // Capture one coherent baseline while audio continues. Reusing it does not
    // mutate it or synchronize later renderer writes into the client shadow.
    const snapshot = await client.captureState();
    const writes = await client.compile(operations, {initialState:snapshot});
    const comparison = await client.compile(operations, {initialState:snapshot});
    if (JSON.stringify(writes) !== JSON.stringify(comparison)) throw Error('Snapshot compilation changed');
    const reservation = await client.schedule(operations, {name, repeatSeconds:1});
    return {audioContext, client, operations, snapshot, writes, reservation,
      async stop() {
        try { await client.clearSchedule(name); }
        finally { await close(); }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (typeof document !== 'undefined') {
  let current;
  const mode = document.getElementById('chip');
  const start = document.getElementById('start'), stop = document.getElementById('stop');
  const trace = document.getElementById('trace'), status = document.getElementById('status');
  start.addEventListener('click', async () => {
    start.disabled = true; mode.disabled = true;
    try {
      current = await startDmgSidTimedExample(mode.value);
      trace.textContent = JSON.stringify({reservation:current.reservation, writes:current.writes}, null, 2);
      status.textContent = `Playing ${mode.selectedOptions[0].textContent} on the AudioWorklet sample clock.`;
      stop.disabled = false;
    } catch (error) {
      status.textContent = error.message;
      start.disabled = false; mode.disabled = false;
    }
  });
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try { await current?.stop(); status.textContent = 'Stopped; the owned runtime is closed.'; }
    catch (error) { status.textContent = error.message; }
    finally { current = null; start.disabled = false; mode.disabled = false; }
  });
}
