import {parseSpcFile} from '../js/spc_file.js';
import {extractBrrSamples, exportBrrSample, readSnesVoices} from '../js/snes_brr.js';
import {scanSpcBrrCandidates} from './spc_brr_candidates.js?v=all-srcns-1';

const time = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const hex = value => `$${value.toString(16).toUpperCase().padStart(4, '0')}`;
function sourceNumberLabel(numbers) {
  const ranges = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i];
    while (i + 1 < numbers.length && numbers[i + 1] === numbers[i] + 1) i++;
    ranges.push(numbers[i] === start ? String(start) : `${start}–${numbers[i]}`);
  }
  return ranges.join(', ');
}
function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const anchor = element('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SPC-specific view composed with the Analyzer's existing transport and FX.
 * Native DSP positions are 32kHz frames; the host seek slider uses milliseconds.
 * RAM is copied only on explicit capture, never for the transport clock poll.
 */
export function mountSpcAnalyzer({root, getAudioContext, getMasterVolume, onAudioReady, onState, onStatus, onEnded}) {
  let revision = 0, parsed = null, runtime = null, initialization = null, timer = null;
  let polling = false, preview = null, output = null, stem = 'sample', visible = false;
  let captureRevision = 0, captureAbort = null, capturing = false;
  let state = {active:false, playing:false, paused:false, busy:false, positionSeconds:0, durationSeconds:180};
  const title = element('h2', 'SNES / SPC', root);
  const summary = element('p', '', root);
  const muteControls = element('div', undefined, root); muteControls.className = 'monitor-toggles';
  const toggles = Array.from({length:8}, (_, channel) => {
    const button = element('button', `Voice ${channel + 1}`, muteControls); button.type = 'button';
    button.className = 'channel-toggle';
    button.setAttribute('aria-pressed', 'true');
    button.addEventListener('click', () => {
      const bit = 1 << channel; state.muteMask ^= bit;
      button.setAttribute('aria-pressed', String(!(state.muteMask & bit)));
      button.classList.toggle('is-muted', Boolean(state.muteMask & bit));
      void perform(async () => {if (runtime) await runtime.setMuteMask(state.muteMask);});
    });
    return button;
  });
  const actions = element('div', undefined, root); actions.className = 'actions';
  const capture = element('button', 'Capture BRR samples', actions); capture.type = 'button';
  const scan = element('button', 'Scan all SRCNs', actions); scan.type = 'button';
  const label = element('label', 'SRCN ', actions);
  const source = element('input', undefined, label); source.type = 'number'; source.min = '0'; source.max = '255'; source.value = '0'; source.style.width = '5em';
  const extract = element('button', 'Extract SRCN', actions); extract.type = 'button';
  const note = element('p', 'BRR preview plays decoded sample data. Its original tuning is unknown; DSP envelopes, pitch modulation and echo are not applied.', root);
  note.className = 'subtext';
  const scanHelp = element('p', 'Scan all SRCNs checks 0–255 in the current RAM snapshot and groups identical start/loop addresses. Readable candidates may include unused or unrelated data.', root);
  scanHelp.className = 'subtext';
  const sampleStatus = element('p', 'Open an SPC file to inspect its samples.', root); sampleStatus.setAttribute('role', 'status');
  const canvas = element('canvas', undefined, root); canvas.width = 900; canvas.height = 150; canvas.style.width = '100%'; canvas.style.maxWidth = '900px'; canvas.setAttribute('aria-label', 'Decoded BRR waveform and loop region');
  const samples = element('div', undefined, root);
  const registers = element('details', undefined, root); element('summary', 'Captured DSP registers', registers);
  const registerOutput = element('pre', '', registers);
  function applyTagFade(position, playing = false) {
    if (!output || !runtime) return;
    const now = runtime.audioContext.currentTime, gain = output.gain;
    const fade = parsed.metadata.fadeSeconds ?? 0, start = parsed.metadata.playSeconds;
    gain.cancelScheduledValues(now);
    const level = start === undefined || fade <= 0 ? 1 : Math.max(0, Math.min(1, 1 - (position - start) / fade));
    gain.setValueAtTime(level, now);
    if (playing && fade > 0 && start !== undefined && position < start + fade) {
      if (position < start) gain.setValueAtTime(1, now + start - position);
      gain.linearRampToValueAtTime(0, now + start + fade - position);
    }
  }
  function emit() {
    summary.textContent = parsed ? `${parsed.metadata.title || stem} · ${time(state.positionSeconds)} / ${time(state.durationSeconds)} · S-DSP 32,000 Hz stereo` : '';
    capture.disabled = scan.disabled = extract.disabled = !state.active || state.busy || capturing;
    onState?.({...state});
  }
  async function perform(fn) {
    try {return await fn();} catch (error) {if (error.name !== 'AbortError') onStatus?.(`SPC: ${error.message}`);}
  }
  function stopPreview() {if (preview) {try {preview.stop();} catch {} preview.disconnect(); preview = null;}}
  function cancelCapture() {
    captureRevision++;
    captureAbort?.abort(); captureAbort = null; capturing = false;
  }
  async function closeAudio() {
    stopPreview(); clearInterval(timer); timer = null;
    const old = runtime; runtime = null; initialization = null;
    output?.disconnect(); output = null;
    await old?.close();
  }
  async function ready() {
    if (initialization) return initialization;
    if (runtime) return runtime;
    const current = revision, bytes = parsed.originalBytes;
    state.busy = true; emit();
    initialization = (async () => {
      const {SpcRuntimeSynth} = await import('../js/spc_audio.js');
      if (current !== revision) throw new DOMException('SPC selection changed', 'AbortError');
      const context = getAudioContext();
      output = context.createGain();
      const synth = new SpcRuntimeSynth({audioContext:context, outputNode:output, masterVolume:getMasterVolume()});
      runtime = synth;
      try {
        await synth.loadSPC(bytes);
        if (current !== revision) throw new DOMException('SPC selection changed', 'AbortError');
        await synth.setMuteMask(state.muteMask);
        onAudioReady?.();
        timer = setInterval(() => {void poll();}, 200);
        return synth;
      } catch (error) {if (runtime === synth) runtime = null; await synth.close(); throw error;}
    })();
    try {return await initialization;} finally {if (current === revision) {initialization = null; state.busy = false; emit();}}
  }
  async function poll() {
    if (!runtime || polling || !state.playing) return;
    polling = true; const current = revision, synth = runtime;
    try {
      const next = await synth.getState();
      if (current !== revision || runtime !== synth) return;
      state.positionSeconds = next.positionSeconds;
      if (state.positionSeconds >= state.durationSeconds) {
        await synth.pause(); state.playing = false; state.paused = false; emit(); onEnded?.();
      } else emit();
    } catch (error) {if (current === revision) onStatus?.(`SPC: ${error.message}`);} finally {polling = false;}
  }
  function draw(entry) {
    const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f2f7f4'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (!entry?.pcm.length) return;
    if (entry.loopStartSamples !== null) {
      context.fillStyle = '#cce2d9'; context.fillRect(entry.loopStartSamples / entry.pcm.length * canvas.width, 0, canvas.width, canvas.height);
    }
    context.strokeStyle = '#17614b'; context.beginPath();
    for (let x = 0; x < canvas.width; x++) {
      const from = Math.floor(x * entry.pcm.length / canvas.width), to = Math.max(from + 1, Math.floor((x + 1) * entry.pcm.length / canvas.width));
      let low = 0, high = 0;
      for (let i = from; i < Math.min(to, entry.pcm.length); i++) {low = Math.min(low, entry.pcm[i]); high = Math.max(high, entry.pcm[i]);}
      context.moveTo(x, (1 - high) * canvas.height / 2); context.lineTo(x, (1 - low) * canvas.height / 2);
    }
    context.stroke();
  }
  async function previewSample(entry) {
    const current = revision, synth = await ready();
    if (current !== revision) return;
    await synth.pause();
    if (current !== revision) return;
    state.playing = false; state.paused = true; emit(); stopPreview();
    output.gain.cancelScheduledValues(synth.audioContext.currentTime); output.gain.value = 1;
    const context = synth.audioContext, buffer = context.createBuffer(1, entry.pcm.length, 32000);
    buffer.copyToChannel(entry.pcm, 0);
    const node = context.createBufferSource(); node.buffer = buffer;
    if (entry.loopStartSamples !== null) {node.loop = true; node.loopStart = entry.loopStartSamples / 32000; node.loopEnd = entry.pcm.length / 32000;}
    node.connect(synth.audio.masterInputNode); preview = node;
    await context.resume();
    if (current !== revision || preview !== node) {node.disconnect(); return;}
    node.start(); if (node.loop) node.stop(context.currentTime + 2);
    node.onended = () => {node.disconnect(); if (preview === node) preview = null;};
  }
  async function captureSamples(sourceNumbers, {scanAll = false} = {}) {
    const current = revision;
    cancelCapture();
    const request = captureRevision, controller = new AbortController();
    captureAbort = controller; capturing = true; emit();
    sampleStatus.textContent = scanAll ? 'Scanning SRCNs 0–255…' : 'Capturing BRR samples…';
    try {
      const snapshot = runtime ? await runtime.snapshot() : {...parsed, nativeFrames:0};
      if (current !== revision || request !== captureRevision) return;
      sourceNumbers ??= [...new Set(Array.from({length:8}, (_, i) => snapshot.dsp[i * 16 + 4]))];
      const found = scanAll
        ? await scanSpcBrrCandidates(snapshot, {signal:controller.signal})
        : extractBrrSamples(snapshot, {sourceNumbers});
      if (current !== revision || request !== captureRevision) return;
      samples.replaceChildren();
      registerOutput.textContent = JSON.stringify({nativeFrames:snapshot.nativeFrames, internalSampleRate:32000,
        voices:readSnesVoices(snapshot), dsp:Array.from(snapshot.dsp)}, null, 2);
      const scanSummary = found.summary;
      sampleStatus.textContent = scanAll
        ? `${found.samples.length} candidate(s) · 256 SRCNs checked · ${scanSummary.aliasEntries} duplicate reference(s) grouped · captured at ${(snapshot.nativeFrames / 32000).toFixed(3)} s. ${scanSummary.invalidEntries} invalid entry/entries skipped.${scanSummary.budgetSkippedEntries ? ` Scan incomplete: ${scanSummary.budgetSkippedEntries} entry/entries exceeded the work limit; use Extract SRCN to inspect a specific number.` : ''}`
        : `${found.samples.length} sample(s) · captured at ${(snapshot.nativeFrames / 32000).toFixed(3)} s.${found.rejected.length ? ` ${found.rejected.length} invalid directory entry/entries skipped.` : ''}`;
      for (const entry of found.samples) {
        const row = element('div', undefined, samples); row.className = 'actions';
        const sourceNumbers = entry.sourceNumbers ?? [entry.sourceNumber];
        row.dataset.sourceNumbers = sourceNumbers.join(',');
        element('span', `SRCN ${sourceNumberLabel(sourceNumbers)} · ${hex(entry.startAddress)} · ${entry.pcm.length} samples${entry.loopStartSamples === null ? '' : ` · loop ${entry.loopStartSamples}`}`, row);
        if (entry.voices.length) element('span', `Voice ${entry.voices.map(voice => voice.index + 1).join(', ')}`, row);
        for (const [text, fn] of [
          ['Waveform', () => draw(entry)], ['Preview', () => perform(() => previewSample(entry))],
          ['BRR', () => download(`${stem}_${entry.sourceNumber}.brr`, entry.brr, 'application/octet-stream')],
          ['WAV', () => download(`${stem}_${entry.sourceNumber}.wav`, exportBrrSample(entry).wav, 'audio/wav')],
          ['Metadata', () => download(`${stem}_${entry.sourceNumber}.json`, JSON.stringify({
            ...exportBrrSample(entry).metadata,
            ...(entry.sourceEntries ? {sourceNumbers, sourceEntries:entry.sourceEntries} : {}),
          }, null, 2), 'application/json')],
        ]) {const button = element('button', text, row); button.type = 'button'; button.addEventListener('click', fn);}
      }
      draw(found.samples[0]);
    } catch (error) {
      if (current === revision && request === captureRevision && error.name !== 'AbortError') sampleStatus.textContent = `BRR capture failed: ${error.message}`;
      throw error;
    } finally {
      if (request === captureRevision) {captureAbort = null; capturing = false; emit();}
    }
  }
  capture.addEventListener('click', () => {void perform(() => captureSamples());});
  scan.addEventListener('click', () => {void perform(() => captureSamples(undefined, {scanAll:true}));});
  extract.addEventListener('click', () => {void perform(() => captureSamples([Number(source.value)]));});
  return {
    get active() {return state.active;}, get state() {return {...state};},
    get outputNode() {return output;}, get audioContext() {return runtime?.audioContext;},
    setVisible(value) {visible = value; if (!visible) stopPreview();},
    async load(bytes, name) {
      const next = parseSpcFile(bytes), current = ++revision;
      cancelCapture();
      await closeAudio();
      if (current !== revision) throw new DOMException('SPC selection changed', 'AbortError');
      parsed = next;
      stem = name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '_') || 'sample';
      state = {active:true, playing:false, paused:false, busy:false, positionSeconds:0, durationSeconds:Math.max(1, Math.min(3600, next.metadata.durationSeconds || 180)), muteMask:0};
      for (const button of toggles) {button.setAttribute('aria-pressed', 'true'); button.classList.remove('is-muted');}
      emit(); await captureSamples(); return next;
    },
    async clear() {const current = ++revision; cancelCapture(); state.active = false; await closeAudio(); if (current !== revision) return; parsed = null; samples.replaceChildren(); draw(); emit();},
    async play() {
      stopPreview(); const current = revision, synth = await ready();
      if (current !== revision) return;
      if (state.positionSeconds >= state.durationSeconds) {await synth.stop(); state.positionSeconds = 0;}
      const next = await synth.play(); if (current !== revision) return;
      state.positionSeconds = next.positionSeconds; applyTagFade(state.positionSeconds, true);
      state.playing = true; state.paused = false; emit();
    },
    async pause() {const current = revision, next = await runtime?.pause(); if (current !== revision) return; state.positionSeconds = next?.positionSeconds ?? state.positionSeconds; applyTagFade(state.positionSeconds); state.playing = false; state.paused = true; emit();},
    async stop() {
      stopPreview();
      if (state.busy) {revision++; await closeAudio(); state.busy = false;}
      else {const current = revision; await runtime?.stop(); if (current !== revision) return;}
      state.playing = state.paused = false; state.positionSeconds = 0; applyTagFade(0); emit();
    },
    async seek(seconds) {stopPreview(); const current = revision, synth = await ready(); if (current !== revision) return; const next = await synth.seek(seconds); if (current !== revision) return; state.positionSeconds = next.positionSeconds; state.playing = next.playing; state.paused = !next.playing; applyTagFade(state.positionSeconds, next.playing); emit();},
    setMasterVolume(value) {runtime?.setMasterVolume(value);},
    async dispose() {revision++; cancelCapture(); state.active = false; await closeAudio();},
  };
}
