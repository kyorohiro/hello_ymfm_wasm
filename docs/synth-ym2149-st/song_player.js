// SPDX-License-Identifier: BSD-3-Clause
const RATE = 44100;
import {editYmSongSnapshot} from './song_live.js?v=paused-edit-1';
const BLOCK = 512;
const defaultSchedule = globalThis.setTimeout.bind(globalThis);
const defaultCancel = globalThis.clearTimeout.bind(globalThis);
const aborted = () => new DOMException('YM2149 song operation cancelled', 'AbortError');

function waitFor(value, signal) {
  const promise = Promise.resolve(value);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : aborted());
    signal.addEventListener('abort', abort, {once: true});
    promise.then(result => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(result);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}

// Native workers may reuse their register arrays. Each history entry belongs to
// a rendered boundary and must remain unchanged until that boundary is heard.
function immutableSnapshot(value, frame, clock) {
  if (!value || !value.registers || value.registers.length !== 16 ||
      (value.registerKnown != null && value.registerKnown.length !== 16))
    throw new Error('YM2149 renderer returned an invalid register snapshot');
  return Object.freeze({
    ...value, frame, clock: value.clock ?? clock,
    registers: Object.freeze(Array.from(value.registers)),
    registerKnown: Object.freeze(Array.from(value.registerKnown ?? Array(16).fill(true), Boolean)),
  });
}

/** A bounded, one-pass reference transport borrowing the Synth's audio graph.
 * Loading is passive; Pause retains the native core and unconsumed PCM. Both
 * synchronous VGM cores and asynchronous Atari workers use the same queue. */
export function createYmSongPlayer({
  getAudio, prepareSource, createEngine,
  beforePlay = async () => {}, onState = () => {}, onStatus = () => {},
  schedule = defaultSchedule, cancel = defaultCancel,
  yieldTask = () => new Promise(resolve => defaultSchedule(resolve, 0)),
  nowMs = () => performance.now(),
  lookaheadSeconds = 0.075, unknownDurationFrames = RATE * 180,
  seekTimeoutMs = 30000,
} = {}) {
  if ([getAudio, prepareSource, createEngine].some(value => typeof value !== 'function'))
    throw new TypeError('YM2149 getAudio, prepareSource, and createEngine are required');
  if (!Number.isFinite(lookaheadSeconds) || lookaheadSeconds < 0.01 || lookaheadSeconds > 0.2 ||
      !Number.isSafeInteger(unknownDurationFrames) || unknownDurationFrames < 1 ||
      !Number.isFinite(seekTimeoutMs) || seekTimeoutMs <= 0)
    throw new RangeError('Invalid YM2149 transport limits');

  let source = null, name = '', subsong = 1, active = null, disposed = false;
  let playback = 'stopped', positionFrames = 0, liveEnabled = true, liveState = null, error = '';
  let operation = null, generation = 0, loadGeneration = 0, loadController = null, loading = false;
  let pending = Promise.resolve();
  const sourceDuration = () => {
    const perSubsong = source?.metadata?.subsongDurationFrames;
    return Array.isArray(perSubsong) && subsong - 1 < perSubsong.length
      ? perSubsong[subsong - 1] ?? null : source?.durationFrames ?? null;
  };
  const duration = () => sourceDuration() ?? (source ? unknownDurationFrames : 0);
  const open = () => { if (disposed) throw new Error('YM2149 song player is disposed'); };
  const current = op => !disposed && operation === op && op.ticket === generation && !op.controller.signal.aborted;
  const notify = message => { try { onStatus(message); } catch {} };

  function position(run = active) {
    if (!run) return positionFrames;
    if (playback !== 'playing') return run.basePosition;
    let frame = run.basePosition;
    for (const segment of run.segments) {
      if (segment.playAt === null || run.context.currentTime < segment.playAt) break;
      const offset = segment.offset + Math.floor(Math.max(0, run.context.currentTime - segment.playAt) * RATE + 1e-7);
      frame = Math.max(frame, segment.firstFrame + Math.min(segment.frames, offset));
    }
    return Math.min(run.renderedFrames, frame);
  }
  function publish(force = false) {
    if (!active || playback === 'seeking') return;
    const frame = position();
    let index = 0;
    while (index + 1 < active.history.length && active.history[index + 1].frame <= frame) index++;
    if (force || liveEnabled || !liveState) liveState = active.history[index] ?? null;
    if (index) active.history.splice(0, index);
  }
  function read() {
    publish();
    const frame = position(), busy = loading || Boolean(operation);
    return {
      playback, state: playback, playing: playback === 'playing', paused: playback === 'paused',
      busy, loading, loaded: Boolean(source), name, positionFrames: frame, durationFrames: duration(),
      positionSeconds: frame / RATE, durationSeconds: duration() / RATE, sampleRate: RATE,
      sourceDurationFrames: sourceDuration(),
      durationLimited: Boolean(source && sourceDuration() == null),
      subsong, subsongCount: source?.subsongCount ?? 1,
      liveEnabled, liveState, error, errorMessage: error,
      clock: source?.clock ?? null, sourceClock: source?.clock ?? null,
      format: source?.format ?? '', metadata: source?.metadata ?? null,
      warnings: source?.warnings ? [...source.warnings] : [],
      seeking: operation?.kind === 'seek', seekProgress: operation?.progress ?? 0,
      canPlay: Boolean(source) && !busy && playback !== 'playing',
      canPause: playback === 'playing', canResume: playback === 'paused' && !busy,
      canStop: busy || Boolean(active) || frame > 0,
      canSeek: Boolean(source) && !loading,
      canEdit: playback==='playing'&&!busy&&typeof active?.engine.editChannel==='function',
    };
  }
  function emit() { try { onState(read()); } catch {} }
  function disconnect(node) { try { node?.disconnect(); } catch {} }
  function disposeEngine(engine) {
    try { Promise.resolve(engine?.dispose()).catch(() => {}); } catch {}
  }
  function cancelNodes(run) {
    if (!run) return;
    if (run.timer !== null) { cancel(run.timer); run.timer = null; }
    for (const segment of run.segments) {
      const node = segment.node;
      segment.node = null; segment.playAt = null;
      try { node?.stop(); } catch {}
      disconnect(node);
    }
    run.nextTime = null;
  }
  function release(run) {
    if (!run || run.released) return;
    run.released = true;
    run.controller.abort();
    cancelNodes(run);
    disconnect(run.gain);
    disposeEngine(run.engine);
  }
  function cancelOperation() {
    if (!operation) return;
    const old = operation;
    operation = null;
    old.controller.abort();
    if (old.deadlineTimer !== null) cancel(old.deadlineTimer);
    if (old.candidate !== active) release(old.candidate);
  }
  function beginOperation(kind) {
    cancelOperation();
    const op = {kind, ticket: ++generation, controller: new AbortController(), candidate: null, deadlineTimer: null, progress: 0};
    operation = op;
    return op;
  }
  function finishOperation(op) {
    if (op.deadlineTimer !== null) { cancel(op.deadlineTimer); op.deadlineTimer = null; }
    if (operation === op) operation = null;
  }
  function resetTransport(cancelLoad = true) {
    generation++;
    cancelOperation();
    if (cancelLoad) {
      loadGeneration++;
      loadController?.abort(); loadController = null; loading = false;
    }
    release(active); active = null;
    positionFrames = 0; playback = 'stopped'; liveState = null; error = '';
  }
  function stop() {
    if (disposed) return;
    resetTransport(); emit();
  }

  async function load(bytes, {name: nextName = '', signal} = {}) {
    open();
    const ticket = ++loadGeneration;
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    loading = true; emit();
    try {
      const next = await waitFor(prepareSource(bytes, {name: nextName, signal: controller.signal}), controller.signal);
      if (disposed || ticket !== loadGeneration || controller.signal.aborted) throw aborted();
      if (!next || !['vgm', 'ym', 'sndh'].includes(next.format) ||
          (next.durationFrames != null && (!Number.isSafeInteger(next.durationFrames) || next.durationFrames < 0)) ||
          (Array.isArray(next.metadata?.subsongDurationFrames) && next.metadata.subsongDurationFrames.some(value =>
            value != null && (!Number.isSafeInteger(value) || value < 0))))
        throw new Error('Invalid YM2149 song source');
      resetTransport(false);
      source = next;
      name = String(nextName || next.title || 'YM2149 reference');
      subsong = Math.max(1, Math.min(next.subsongCount || 1, next.defaultSubsong || 1));
      if (sourceDuration() == null)
        notify(`Song duration is unknown; reference playback is limited to ${unknownDurationFrames / RATE} seconds.`);
      loading = false;
      return read();
    } finally {
      signal?.removeEventListener('abort', abort);
      if (ticket === loadGeneration) { loading = false; loadController = null; emit(); }
    }
  }

  async function host(op) {
    await waitFor(beforePlay(), op.controller.signal);
    const audio = await waitFor(getAudio(), op.controller.signal);
    if (!current(op)) throw aborted();
    const context = audio?.context, output = audio?.songInputNode;
    if (!context || !output || output.context !== context || context.state === 'closed')
      throw new Error('YM2149 reference playback requires the Synth AudioContext and songInputNode');
    if (context.state !== 'running') await waitFor(context.resume(), op.controller.signal);
    if (!current(op)) throw aborted();
    return {context, output};
  }
  async function createRun(op, output) {
    const created = Promise.resolve().then(() => createEngine(source, {subsong, signal: op.controller.signal}));
    created.then(engine => { if (!current(op)) disposeEngine(engine); }, () => {});
    const engine = await waitFor(created, op.controller.signal);
    if (!current(op)) { disposeEngine(engine); throw aborted(); }
    let gain;
    const run = { ...output, engine, controller: new AbortController(), gain: null,
      history: [], renderedFrames: 0, basePosition: 0, segments: [], nextTime: null,
      timer: null, fillPromise: null, eof: false, released: false, lastEmitTime: null };
    op.candidate = run;
    try {
      if (engine.sampleRate() !== RATE) throw new Error('YM2149 reference renderer must use 44100 Hz');
      gain = run.gain = output.context.createGain();
      gain.gain.value = 1; gain.connect(output.output);
      const snapshot = await waitFor(engine.snapshot(), op.controller.signal);
      if (!current(op)) throw aborted();
      run.history = [immutableSnapshot(snapshot, 0, engine.clock ?? source.clock)];
      return run;
    } catch (failure) { release(run); throw failure; }
  }
  function renderLength(result, requested) {
    if (!result?.left || !result?.right || result.left.length !== result.right.length ||
        !Number.isInteger(result.left.length) || result.left.length < 0 || result.left.length > requested)
      throw new Error('Invalid YM2149 render length');
    return result.left.length;
  }
  function scheduleSegment(run, segment) {
    if (segment.playAt !== null || run.released || playback !== 'playing') return;
    const offset = Math.max(0, run.basePosition - segment.firstFrame);
    if (offset >= segment.frames) return;
    const at = Math.max(run.nextTime ?? 0, run.context.currentTime + 0.01);
    const node = run.context.createBufferSource();
    node.buffer = segment.buffer; node.connect(run.gain);
    segment.node = node; segment.offset = offset; segment.playAt = at;
    node.onended = () => { disconnect(node); if (segment.node === node) segment.node = null; };
    try { node.start(at, offset / RATE); }
    catch (failure) { disconnect(node); segment.node = null; segment.playAt = null; throw failure; }
    run.nextTime = at + (segment.frames - offset) / RATE;
  }
  function scheduleQueued(run) { for (const segment of run.segments) scheduleSegment(run, segment); }
  function append(run, result, frames, snapshot) {
    for (let i = 0; i < frames; i++)
      if (!Number.isFinite(result.left[i]) || !Number.isFinite(result.right[i]))
        throw new Error('Non-finite YM2149 song output');
    const buffer = run.context.createBuffer(2, frames, RATE);
    buffer.copyToChannel(result.left.subarray(0, frames), 0);
    buffer.copyToChannel(result.right.subarray(0, frames), 1);
    run.segments.push({buffer, frames, firstFrame: run.renderedFrames, node: null, offset: 0, playAt: null});
    run.renderedFrames += frames;
    run.history.push(immutableSnapshot(snapshot, run.renderedFrames, run.engine.clock ?? source?.clock));
  }
  function fail(failure, run = active) {
    if (run && active !== run) return;
    positionFrames = position();
    publish(true); release(active); active = null;
    playback = 'error'; error = failure?.message ?? String(failure);
    notify(`YM2149 song playback failed: ${error}`); emit();
  }
  function pump(run) {
    if (run.fillPromise) return run.fillPromise;
    if (active !== run || run.released || playback !== 'playing') return Promise.resolve();
    const fill = async () => {
      try {
        const consumed = position(run);
        positionFrames = run.basePosition = consumed;
        publish();
        run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > consumed);
        const deadline = nowMs() + 8;
        for (let blocks = 0; blocks < 16 && !run.eof && playback === 'playing'; blocks++) {
          if ((run.renderedFrames - position(run)) / RATE >= lookaheadSeconds || (blocks && nowMs() >= deadline)) break;
          const requested = Math.min(BLOCK, duration() - run.renderedFrames);
          if (requested <= 0) { run.eof = true; break; }
          for(const edit of run.pendingEdits?.splice(0)??[])run.engine.editChannel(edit.channel,edit.patch);
          const result = await waitFor(run.engine.processFrames(requested), run.controller.signal);
          if (run.released || active !== run) return;
          const frames = renderLength(result, requested);
          const snapshot = result.snapshot ?? await waitFor(run.engine.snapshot(), run.controller.signal);
          if (run.released || active !== run) return;
          if (frames) append(run, result, frames, snapshot);
          run.eof = Boolean(run.engine.ended) || run.renderedFrames >= duration();
          if (!frames) {
            if (!run.eof) throw new Error('YM2149 renderer made no progress');
            break;
          }
        }
        if (run.released || active !== run) return;
        if (playback === 'playing') scheduleQueued(run);
        if (playback === 'playing' && run.eof && position(run) >= run.renderedFrames) {
          positionFrames = run.renderedFrames; publish(true);
          active = null; playback = 'ended'; release(run); emit(); return;
        }
        if (run.lastEmitTime === null || run.context.currentTime - run.lastEmitTime >= 0.05) {
          run.lastEmitTime = run.context.currentTime; emit();
        }
      } catch (failure) {
        if (!run.released && active === run) fail(failure, run);
      } finally {
        run.fillPromise = null;
        if (!run.released && active === run && playback === 'playing' && run.timer === null)
          run.timer = schedule(() => { run.timer = null; void pump(run); }, 8);
      }
    };
    // A full queue can make fill() finish without reaching an await. Start it
    // after assigning the promise so its finally cannot be overwritten by an
    // already-resolved promise that would block every subsequent refill.
    run.fillPromise = Promise.resolve().then(fill);
    return run.fillPromise;
  }
  function startSeekDeadline(op) {
    if (op.deadlineTimer !== null) return;
    op.deadlineMs = nowMs() + seekTimeoutMs;
    op.deadlineTimer = schedule(() => op.controller.abort(new Error(`YM2149 seek exceeded ${seekTimeoutMs / 1000} seconds`)), seekTimeoutMs);
  }
  async function advance(op, run, target) {
    startSeekDeadline(op);
    const deadline = op.deadlineMs;
    let frame = 0, batch = 0, batchStart = nowMs();
    while (frame < target) {
      if (!current(op)) throw op.controller.signal.reason ?? aborted();
      if (nowMs() >= deadline) throw new Error(`YM2149 seek exceeded ${seekTimeoutMs / 1000} seconds`);
      const requested = Math.min(2048, target - frame);
      const result = await waitFor(run.engine.processFrames(requested), op.controller.signal);
      if (!current(op)) throw op.controller.signal.reason ?? aborted();
      const frames = renderLength(result, requested);
      frame += frames;
      if (!frames) {
        if (!run.engine.ended) throw new Error('YM2149 renderer made no seek progress');
        break;
      }
      if (++batch >= 32 || nowMs() - batchStart >= 8 || frame >= target) {
        op.progress = target ? frame / target : 1; emit();
        await waitFor(yieldTask(), op.controller.signal);
        batch = 0; batchStart = nowMs();
      }
      if (run.engine.ended) break;
    }
    if (!current(op)) throw op.controller.signal.reason ?? aborted();
    const snapshot = await waitFor(run.engine.snapshot(), op.controller.signal);
    if (!current(op)) throw op.controller.signal.reason ?? aborted();
    run.basePosition = run.renderedFrames = frame;
    run.history = [immutableSnapshot(snapshot, frame, run.engine.clock ?? source.clock)];
    run.eof = Boolean(run.engine.ended) || frame >= duration();
    return frame;
  }
  async function play() {
    open();
    if (loading || operation) return false;
    if (!source) throw new Error('Choose a VGM, VGZ, YM, or SNDH song first');
    if (playback === 'paused') return resume();
    if (playback === 'playing') return true;
    const target = playback === 'ended' ? 0 : positionFrames;
    const op = beginOperation('play');
    release(active); active = null; playback = 'starting'; error = ''; liveState = null; emit();
    try {
      const run = await createRun(op, await host(op));
      if (target) await advance(op, run, target);
      if (!current(op)) throw aborted();
      active = run; op.candidate = null; finishOperation(op);
      positionFrames = run.basePosition; playback = 'playing'; publish(true);
      await pump(run); emit();
      return playback === 'playing' || playback === 'ended';
    } catch (failure) {
      release(op.candidate);
      if (operation === op) { finishOperation(op); fail(failure); }
      return false;
    }
  }
  function pause() {
    open();
    if (!active || playback !== 'playing') return false;
    const run = active;
    positionFrames = run.basePosition = position(run);
    publish(true); cancelNodes(run);
    run.segments = run.segments.filter(segment => segment.firstFrame + segment.frames > positionFrames);
    playback = 'paused'; emit(); return true;
  }
  async function resume() {
    open();
    if (!active || playback !== 'paused' || loading || operation) return false;
    const run = active, op = beginOperation('resume');
    playback = 'starting'; emit();
    try {
      const output = await host(op);
      if (output.context !== run.context || output.output !== run.output)
        throw new Error('Song audio output changed; Stop and Play to restart');
      if (!current(op) || active !== run) throw aborted();
      finishOperation(op); playback = 'playing'; scheduleQueued(run);
      await pump(run); emit(); return playback === 'playing' || playback === 'ended';
    } catch (failure) {
      if (operation === op) { finishOperation(op); fail(failure, run); }
      return false;
    }
  }
  async function seek(seconds) {
    open();
    if (!source || !Number.isFinite(seconds)) throw new TypeError('Choose a song and a finite seek position');
    if (loading) return false;
    const target = Math.round(Math.max(0, Math.min(duration() / RATE, seconds)) * RATE);
    const previous = active;
    const previousPlayback = operation?.previousPlayback ?? (playback === 'playing' ? 'playing' : 'paused');
    const previousPosition = position();
    if (previous) {
      previous.basePosition = previousPosition; publish(true); cancelNodes(previous);
      previous.segments = previous.segments.filter(segment => segment.firstFrame + segment.frames > previousPosition);
    }
    const op = beginOperation('seek');
    op.previousPlayback = previousPlayback;
    if (!previous) {
      finishOperation(op); positionFrames = target; playback = 'stopped'; liveState = null; error = ''; emit(); return true;
    }
    playback = 'seeking'; emit();
    try {
      startSeekDeadline(op);
      const next = await createRun(op, {context: previous.context, output: previous.output});
      await advance(op, next, target);
      if (!current(op)) throw aborted();
      active = next; op.candidate = null; finishOperation(op);
      positionFrames = next.basePosition; playback = previousPlayback; liveState = null; error = '';
      release(previous); publish(true);
      if (playback === 'playing') await pump(next);
      emit(); return true;
    } catch (failure) {
      release(op.candidate);
      if (operation !== op) return false;
      finishOperation(op);
      active = previous; positionFrames = previousPosition; playback = previousPlayback;
      if (failure?.name !== 'AbortError') {
        error = failure?.message ?? String(failure); notify(`YM2149 song seek failed: ${error}`);
      }
      if (playback === 'playing') { scheduleQueued(previous); void pump(previous); }
      emit(); return false;
    }
  }
  function setSubsong(value) {
    open();
    if (!source || !Number.isInteger(value) || value < 1 || value > (source.subsongCount || 1))
      throw new RangeError('YM2149 subsong is outside the loaded song');
    if (value !== subsong) { resetTransport(); subsong = value; emit(); }
    return read();
  }
  function setLive(value) {
    open();
    if (typeof value !== 'boolean') throw new TypeError('Live state must be boolean');
    liveEnabled = value; if (value) publish(true); emit(); return read();
  }
  function clear() { open(); resetTransport(); source = null; name = ''; subsong = 1; emit(); }
  function dispose() {
    if (disposed) return;
    resetTransport(); disposed = true; source = null; name = ''; emit();
  }
  const track = fn => (...args) => {
    const result = fn(...args); pending = Promise.resolve(result).catch(() => {}); return result;
  };
  function editChannel(channel,patch) {
    open();
    if(!read().canEdit)return false;
    editYmSongSnapshot(liveState,channel,patch);
    (active.pendingEdits??=[]).push({channel,patch:structuredClone(patch)});
    return true;
  }
  return {load: track(load), play: track(play), pause, resume: track(resume), stop,editChannel,
    seek: track(seek), setSubsong, setLive, read, getState: read, setLiveEnabled: setLive,
    clear, unload: clear, whenIdle: () => pending, dispose};
}
