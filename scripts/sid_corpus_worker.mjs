// SPDX-License-Identifier: BSD-3-Clause
// Isolated, device-free execution. No music, ROM or PCM files are written.
import {parentPort, workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';

const binaries = Object.fromEntries(await Promise.all(Object.entries(workerData.wasm).map(async ([key, path]) => [key, await readFile(path)])));

export function classifyCorpusError(error, stage) {
  const code = typeof error.code === 'string' ? error.code : null, message = String(error.message ?? error);
  if (/ROM_REQUIRED$/.test(code ?? '') || /unimplemented.*ROM|mapped BASIC\/KERNAL ROM|provide your C64 ROM|requires? (?:the ROM|your character)/i.test(message)) return 'needs_rom';
  if (/_(?:INVALID|LIMIT)$/.test(code ?? '') || stage === 'metadata' && !/_UNSUPPORTED$/.test(code ?? '')) return 'invalid';
  if (/_UNSUPPORTED$/.test(code ?? '') || /unsupported C64 I\/O|changes 6510 memory banking/i.test(message)) return 'unsupported';
  return 'runtime_failed';
}

parentPort.on('message', async job => {
  let core = null, stage = 'create', rendered = 0, squares = 0, peak = 0, finite = true;
  const started = performance.now();
  try {
    const Core = job.backend === 'vbi' ? SidPlayerCore : RsidPlayerCore;
    // A new WASM instance for every input. Only the immutable binary is cached.
    core = await Core.create({sampleRate: job.sampleRate, wasmBinary: binaries[job.backend === 'vbi' ? 'vbi' : 'c64']});
    stage = 'load'; core.load(job.bytes, job.options);
    stage = 'render';
    const scratch = new Float32Array(4096);
    while (rendered < job.frames) {
      const length = Math.min(scratch.length, job.frames - rendered), output = scratch.subarray(0, length);
      core.renderInto(output);
      for (const value of output) {
        if (!Number.isFinite(value)) {finite = false; throw new Error('Non-finite SID PCM output');}
        squares += value * value; peak = Math.max(peak, Math.abs(value));
      }
      rendered += length;
    }
    const state = core.getState();
    stage = 'stop'; core.stop();
    const stopState = core.getState(), stopped = core.render(128), afterStop = core.getState();
    const stopZero = stopped.every(value => value === 0), stopStable = !afterStop.playing && afterStop.cycles === stopState.cycles;
    if (!stopZero || !stopStable) throw new Error('Stop output or stopped CPU state was not stable');
    parentPort.postMessage({id: job.id, status: peak === 0 ? 'executed_silent' : 'executed_nonzero', stage: 'complete',
      execution: {backend: job.backend, subtune: state.subtune, timing: state.timing, frames: rendered,
        finite, rms: Math.sqrt(squares / Math.max(1, rendered)), peak, stopZero, stopStable, stoppedCycles: afterStop.cycles,
        cycles: state.cycles, initCycles: state.initCycles, initReturned: state.initReturned ?? true,
        playCalls: state.playCalls, irqCount: state.irqCount ?? 0, nmiCount: state.nmiCount ?? 0,
        driverAddress: state.driverAddress, elapsedMs: Math.round(performance.now() - started)}});
  } catch (error) {
    let stopZero = null;
    if (core) {try {core.stop(); stopZero = core.render(128).every(value => value === 0);} catch {stopZero = false;}}
    const phase = error.code === 11 ? 'init' : error.code === 12 ? 'play'
      : error.code === 5 && /initialization/i.test(error.message ?? '') ? 'init'
      : error.code === 5 && /play subroutine/i.test(error.message ?? '') ? 'play' : stage;
    parentPort.postMessage({id: job.id, status: classifyCorpusError(error, stage), stage,
      error: {code: error.code ?? null, message: String(error.message ?? error), address: error.address ?? null,
        phase},
      execution: {backend: job.backend, frames: rendered, finite, rms: Math.sqrt(squares / Math.max(1, rendered)), peak,
        stopZero, elapsedMs: Math.round(performance.now() - started)}});
  } finally {core?.dispose();}
});
