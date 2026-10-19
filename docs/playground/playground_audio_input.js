import {createSampleEdit, normalizeSampleEdit, decodeSampleWav} from '../js/playground_sample_edit.js?v=native-voices-3';

const abortError = () => new DOMException('Audio input cancelled', 'AbortError');
const noteName = midi => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi % 12] + (Math.floor(midi / 12) - 1);
const copy = value => JSON.parse(JSON.stringify(value));

/** Shared non-destructive editor. Conversion and analysis run in a separate Worker. */
export function createPlaygroundAudioInput({document:doc = globalThis.document, getAudioContext, getPreviewDestination,
  mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  recordingSeconds = 60, defaultTarget = 'rf5c164', loadAsset, saveAsset,
  workerFactory = () => new Worker(new URL('./playground_sample_editor_worker.js?v=native-voices-3', import.meta.url), {type:'module'})} = {}) {
  let active = false;
  return function inputAudio(options = {}, {signal} = {}) {
    signal?.throwIfAborted();
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        options.title !== undefined && typeof options.title !== 'string' ||
        options.asset !== undefined && typeof options.asset !== 'string' ||
        options.edit !== undefined && typeof options.edit !== 'boolean' ||
        options.saveOnly !== undefined && typeof options.saveOnly !== 'boolean') return Promise.reject(new TypeError('Expected {title?, asset?, edit?, saveOnly?}.'));
    if (active) return Promise.reject(new Error('A Sample Editor is already open.'));
    active = true;
    return new Promise((resolve,reject) => {
      const previousFocus = doc.activeElement, dialog = doc.createElement('dialog');
      dialog.className = 'playground-settings-dialog sample-editor'; dialog.dataset.audioInput = '';
      dialog.setAttribute('aria-label','Sample Editor');
      dialog.innerHTML = `<h2></h2>
        <div class="sample-row"><label>Audio file <input data-audio-file type="file" accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.webm"></label>
          <button type="button" data-audio-action="record">Record microphone</button><button type="button" data-audio-action="stop" hidden>Finish recording</button>
          <button type="button" data-action="new-wave">Draw a cycle</button></div>
        <div class="sample-row"><label>Instrument <select data-field="target"><option value="rf5c164">RF5C164 · 8 voices</option><option value="adpcm-b">ADPCM-B · 1 voice</option><option value="gameboy-wave">Game Boy · 32-point wave</option></select></label>
          <label>Rate <select data-field="rate"><option>8000</option><option>12000</option><option selected>16000</option><option>22050</option><option>32000</option></select> Hz</label>
          <label>Tool <select data-field="tool"><option value="select">Select</option><option value="draw">Draw samples</option></select></label></div>
        <canvas data-wave width="800" height="220" aria-label="Sample waveform; drag to select start and end"></canvas>
        <input class="sample-scroll" data-field="scroll" type="range" min="0" max="1000" value="0" aria-label="Waveform scroll">
        <div class="sample-row"><button type="button" data-action="full">Full recording</button><button type="button" data-action="zoom">Zoom selection</button><button type="button" data-action="zoom-out">Zoom out</button>
          <button type="button" data-action="undo">Undo</button><button type="button" data-action="redo">Redo</button><button type="button" data-action="reset">Reset edits</button></div>
        <div class="sample-fields">
          <label>Start (seconds)<input data-field="startFrame" type="number" min="0" step="0.001"></label>
          <label>End (seconds)<input data-field="endFrame" type="number" min="0" step="0.001"></label>
          <label>Gain (dB)<input data-field="gainDb" type="number" min="-60" max="24" step="0.5"></label>
          <label>Fade in (ms)<input data-field="fadeInSeconds" type="number" min="0" step="1"></label>
          <label>Fade out (ms)<input data-field="fadeOutSeconds" type="number" min="0" step="1"></label>
          <label>Root note <select data-field="rootMidi"></select></label>
          <label>Tuning (cents)<input data-field="tuneCents" type="number" min="-100" max="100" step="0.1"></label>
          <label>Loop start (seconds)<input data-field="loopStartFrame" type="number" min="0" step="0.001"></label>
          <label>Loop end (seconds)<input data-field="loopEndFrame" type="number" min="0" step="0.001"></label>
        </div>
        <div class="sample-row"><label><input data-field="loopEnabled" type="checkbox">Loop</label><button type="button" data-action="normalize">Normalize</button>
          <button type="button" data-action="pitch">Detect pitch</button><button type="button" data-action="apply-pitch" disabled>Use detected note</button><button type="button" data-action="cycle">Select one cycle</button></div>
        <p class="sample-help" data-pitch>No pitch estimate. Root note can always be set by hand.</p>
        <div class="sample-row"><button type="button" data-action="preview-original">Preview original selection</button><button type="button" data-action="preview">Preview edits</button><button type="button" data-action="silence">Stop preview</button></div>
        <p class="sample-status" data-audio-input-status role="status"></p>
        <p class="sample-help">Keep the full recording; only the selected region is converted. Game Boy uses one cycle. Draw samples after zooming in.</p>
        <div class="sample-row sample-footer"><label class="sample-save"><input data-field="save" type="checkbox" checked>Save in Cassette <input data-field="asset" aria-label="Sample asset path" value="/samples/sampler.sample.json"></label>
          <button type="button" data-audio-action="cancel">Cancel</button><button type="button" data-audio-action="use" disabled>Use audio</button></div>`;
      dialog.querySelector('h2').textContent = options.title || 'Sample Editor';
      const field = name => dialog.querySelector(`[data-field="${name}"]`);
      const action = name => dialog.querySelector(`[data-action="${name}"]`);
      const audioAction = name => dialog.querySelector(`[data-audio-action="${name}"]`);
      const file = dialog.querySelector('[data-audio-file]'), record = audioAction('record'), stop = audioAction('stop'), use = audioAction('use');
      if (options.saveOnly) use.textContent = 'Save sample';
      const canvas = dialog.querySelector('canvas'), status = dialog.querySelector('[role="status"]');
      for (let midi = 0; midi < 128; midi++) {const option = doc.createElement('option'); option.value = midi; option.textContent = `${noteName(midi)} (${midi})`; field('rootMidi').append(option);}
      field('target').value = defaultTarget; field('asset').value = options.asset || '/samples/sampler.sample.json';
      field('save').checked = Boolean(saveAsset); field('save').disabled = !saveAsset;
      let done = false, busy = false, generation = 0, audio = null, edit = null, sourceKind = 'file', sourceName = '', detected = null, conversionTargets = {};
      let stream = null, recorder = null, timer = null, recording = false, preview = null, previewSequence = 0, worker = null, sequence = 0;
      let viewport = [0,1], peaks = null, scheduledDraw = null, drag = null, undo = [], redo = [];
      const pending = new Map();
      const say = (text,error = false) => {status.textContent = text; status.dataset.error = String(error);};
      const job = (command,data = {}) => {
        if (done) return Promise.reject(abortError());
        if (!worker) {
          worker = workerFactory();
          worker.onmessage = ({data}) => {const request = pending.get(data.id); if (!request) return; pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);};
          worker.onerror = event => {for (const request of pending.values()) request.reject(new Error(event.message || 'Sample processing failed.')); pending.clear();};
        }
        return new Promise((resolve,reject) => {const id = ++sequence; pending.set(id,{resolve,reject}); worker.postMessage({id,command,...data});});
      };
      const stopPreview = () => {
        previewSequence++;
        if (!preview) return;
        const current = preview; preview = null; const now = current.context.currentTime;
        try {
          const gain = current.gain.gain;
          if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
          else {gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value,now);}
          gain.linearRampToValueAtTime(0,now+.005); current.node.stop(now+.006);
        } catch {current.node.disconnect(); current.gain.disconnect();}
      };
      const stopTracks = () => {stream?.getTracks().forEach(track => track.stop()); stream = null;};
      const releaseCapture = () => {
        clearTimeout(timer); timer = null; const current = recorder; recorder = null;
        if (current && current.state !== 'inactive') {try {current.stop();} catch {}}
        stopTracks(); recording = false;
      };
      const finish = (value,error) => {
        if (done) return; done = true; generation++; stopPreview(); releaseCapture();
        signal?.removeEventListener('abort',abort); doc.defaultView?.removeEventListener('pagehide',abort); doc.removeEventListener('visibilitychange',visibility);
        if (scheduledDraw !== null) doc.defaultView.cancelAnimationFrame(scheduledDraw);
        worker?.terminate(); for (const request of pending.values()) request.reject(abortError()); pending.clear();
        if (dialog.open) dialog.close(); dialog.remove(); active = false;
        if (previousFocus?.isConnected) previousFocus.focus(); error ? reject(error) : resolve(value);
      };
      const abort = () => finish(null,signal?.reason ?? abortError());
      const available = () => Boolean(mediaDevices?.getUserMedia && Recorder);
      const controls = () => {
        for (const element of dialog.querySelectorAll('button,input,select')) element.disabled = busy;
        audioAction('cancel').disabled = false;
        if (!busy) {
          record.disabled = !available(); use.disabled = !audio;
          field('save').disabled = !saveAsset || options.saveOnly;
          action('undo').disabled = !undo.length; action('redo').disabled = !redo.length;
          action('apply-pitch').disabled = !detected?.hz;
          field('rate').disabled = field('target').value === 'gameboy-wave';
        }
      };
      const lock = () => {busy = true; controls();};
      const idle = () => {busy = false; controls(); record.hidden = false; stop.hidden = true;};
      const failed = error => {releaseCapture(); idle(); say(error.message ?? String(error),true);};
      const remember = () => {if (edit) {undo.push(copy(edit)); if (undo.length > 32) undo.shift(); redo = [];}};
      const update = () => {
        if (!edit) return;
        for (const key of ['startFrame','endFrame','loopStartFrame','loopEndFrame']) field(key).value = (edit[key] / audio.sampleRate).toFixed(6);
        for (const key of ['fadeInSeconds','fadeOutSeconds']) field(key).value = Math.round(edit[key] * 1000);
        field('gainDb').value = Number(edit.gainDb.toFixed(2)); field('tuneCents').value = Number(edit.tuneCents.toFixed(1)); field('rootMidi').value = edit.rootMidi;
        field('loopEnabled').checked = edit.loopEnabled; action('undo').disabled = !undo.length; action('redo').disabled = !redo.length;
        const span = viewport[1]-viewport[0], maximum = Math.max(1,audio.channels[0].length-span);
        field('scroll').value = Math.round(viewport[0]/maximum*1000); field('scroll').disabled = span >= audio.channels[0].length;
        queueDraw();
      };
      function queueDraw() {if (scheduledDraw === null && !done) scheduledDraw = doc.defaultView.requestAnimationFrame(() => {scheduledDraw = null; draw();});}
      function draw() {
        const ctx = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
        ctx.fillStyle = '#182327'; ctx.fillRect(0,0,width,height); ctx.strokeStyle = '#526269'; ctx.beginPath(); ctx.moveTo(0,height/2); ctx.lineTo(width,height/2); ctx.stroke();
        if (!audio || !edit || !peaks) return;
        const data = peaks.mono ?? audio.channels[0], span = Math.max(1,viewport[1]-viewport[0]), x = frame => (frame-viewport[0])/span*width;
        ctx.fillStyle = '#1a6b7a66'; ctx.fillRect(x(edit.startFrame),0,x(edit.endFrame)-x(edit.startFrame),height);
        const gain = 10**(edit.gainDb/20); ctx.strokeStyle = '#83d9cd'; ctx.beginPath();
        for (let px = 0; px < width; px++) {
          const first = Math.floor(viewport[0]+px/width*span), last = Math.max(first+1,Math.ceil(viewport[0]+(px+1)/width*span)); let low = 1, high = -1;
          if (last-first > 256) {for (let bin = Math.floor(first/128); bin <= Math.min(peaks.low.length-1,Math.floor((last-1)/128)); bin++) {low = Math.min(low,peaks.low[bin]); high = Math.max(high,peaks.high[bin]);}}
          else for (let i = first; i < Math.min(data.length,last); i++) {low = Math.min(low,data[i]); high = Math.max(high,data[i]);}
          const inside = first >= edit.startFrame && first < edit.endFrame;
          const fade = inside ? Math.min(1,edit.fadeInSeconds ? (first-edit.startFrame)/(edit.fadeInSeconds*audio.sampleRate) : 1,edit.fadeOutSeconds ? (edit.endFrame-1-first)/(edit.fadeOutSeconds*audio.sampleRate) : 1) : 1;
          const scale = inside ? gain*Math.max(0,fade) : .35; ctx.moveTo(px,height/2-low*scale*(height/2-8)); ctx.lineTo(px,height/2-high*scale*(height/2-8));
        }
        ctx.stroke();
        for (const stroke of [...(edit.drawStrokes ?? []),...(drag?.points ? [drag.points] : [])]) {ctx.strokeStyle = '#ffbd83'; ctx.beginPath(); let first = true; for (const [frame,value] of stroke) {if (first) ctx.moveTo(x(frame),height/2-value*(height/2-8)); else ctx.lineTo(x(frame),height/2-value*(height/2-8)); first = false;} ctx.stroke();}
        for (const [key,color,label] of [['startFrame','#fbdc84','Start'],['endFrame','#fbdc84','End'],...(edit.loopEnabled ? [['loopStartFrame','#cbb8ff','Loop'],['loopEndFrame','#cbb8ff','Loop end']] : [])]) {const px = x(edit[key]); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,height); ctx.stroke(); ctx.fillText(label,Math.max(2,Math.min(width-60,px+4)),key.startsWith('loop') ? 28 : 14);}
      }
      const apply = next => {
        const normalized = normalizeSampleEdit(audio,next);
        if (detected && ['startFrame','endFrame','drawPoints','drawStrokes'].some(key => JSON.stringify(edit?.[key]) !== JSON.stringify(normalized[key]))) {
          detected = null; action('apply-pitch').disabled = true;
          dialog.querySelector('[data-pitch]').textContent = 'Selection changed. Detect pitch again, or set the root note by hand.';
        }
        edit = normalized; generation++; stopPreview(); use.disabled = false; update();
      };
      async function installAudio(next,name,kind,settings,token = generation) {
        if (!next.channels?.length || next.channels.length > 2 || !next.channels[0].length || next.channels[0].length/next.sampleRate > 300) throw new Error('Choose mono/stereo audio up to five minutes long.');
        audio = next; sourceName = name; sourceKind = kind; detected = null; undo = []; redo = [];
        const targets = ['rf5c164','adpcm-b','gameboy-wave'];
        conversionTargets = Object.fromEntries(Object.entries(settings?.conversionTargets ?? {}).filter(([mode,target]) => targets.includes(mode) && targets.includes(target)));
        field('target').value = conversionTargets[defaultTarget] ?? defaultTarget;
        if (settings?.outputSampleRate && Array.from(field('rate').options).some(option => Number(option.value) === settings.outputSampleRate)) field('rate').value = settings.outputSampleRate;
        edit = createSampleEdit(audio,{settings:settings ?? {endFrame:Math.min(audio.channels[0].length,Math.round(audio.sampleRate*3)),fadeInSeconds:.005,fadeOutSeconds:.005}});
        viewport = [0,audio.channels[0].length]; peaks = null;
        peaks = await job('source',{audio}); if (done || token !== generation) return;
        idle(); update(); action('apply-pitch').disabled = true; dialog.querySelector('[data-pitch]').textContent = 'No pitch estimate. Root note can always be set by hand.';
        say(`${sourceName} · ${(audio.channels[0].length/audio.sampleRate).toFixed(2)} seconds. Choose a region, then Use audio.`);
      }
      async function decode(blob,name,kind,token) {
        const bytes = await blob.arrayBuffer(); if (done || token !== generation) return; const context = await getAudioContext(); if (done || token !== generation) return;
        const buffer = await context.decodeAudioData(bytes); if (done || token !== generation) return;
        await installAudio({sampleRate:buffer.sampleRate,channels:Array.from({length:buffer.numberOfChannels},(_,ch) => new Float32Array(buffer.getChannelData(ch)))},name,kind,undefined,token);
      }
      file.addEventListener('change',async () => {
        const chosen = file.files?.[0]; if (!chosen) return; const token = ++generation; stopPreview(); releaseCapture(); lock(); say('Reading audio…');
        try {if (chosen.size > 64*1024*1024) throw new Error('Choose a file smaller than 64 MiB.'); await decode(chosen,chosen.name,'file',token);} catch(error) {if (!done && token === generation) failed(error);}
      });
      const stopRecording = () => {
        if (!recorder || recorder.state === 'inactive') return; clearTimeout(timer); timer = null; stop.disabled = true; recording = false; say('Preparing recording…');
        try {recorder.stop();} catch(error) {failed(error);} stopTracks();
      };
      record.addEventListener('click',async () => {
        const token = ++generation; stopPreview(); lock(); say('Waiting for microphone access…');
        try {
          const capture = await mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
          if (done || token !== generation) {capture.getTracks().forEach(track => track.stop()); return;}
          stream = capture; const mimeType = ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type => Recorder.isTypeSupported?.(type));
          const current = recorder = new Recorder(stream,mimeType ? {mimeType} : {}), chunks = [];
          current.addEventListener('dataavailable',event => {if (event.data?.size) chunks.push(event.data);});
          current.addEventListener('error',event => {if (!done && token === generation) {generation++; failed(event.error ?? new Error('Recording failed.'));}});
          current.addEventListener('stop',async () => {if (done || token !== generation) return; stopTracks(); recorder = null; clearTimeout(timer); timer = null; try {const blob = new Blob(chunks,{type:current.mimeType || mimeType || 'audio/webm'}); if (!blob.size) throw new Error('No audio was recorded.'); await decode(blob,'Microphone recording','microphone',token);} catch(error) {if (!done && token === generation) failed(error);}}, {once:true});
          current.start(); recording = true; record.hidden = true; stop.hidden = false; stop.disabled = false; say(`Recording… Finish when ready (up to ${recordingSeconds} seconds).`); timer = setTimeout(stopRecording,recordingSeconds*1000); stop.focus();
        } catch(error) {if (!done && token === generation) failed(error);}
      });
      const visibility = () => {if (doc.hidden) {stopPreview(); if (recording) stopRecording();}};
      stop.addEventListener('click',stopRecording); audioAction('cancel').addEventListener('click',() => finish(null));
      const prepared = (target = field('target').value, settings = edit, mono = true) => job('render',{settings,options:{target,mono,sampleRate:target === 'original' ? audio.sampleRate : Number(field('rate').value)}});
      async function useAudio(persist = true) {
        const token = generation; lock(); stopPreview(); say(options.saveOnly ? 'Saving sample…' : 'Preparing instrument…');
        try {
          const rendered = await prepared(options.saveOnly ? 'original' : field('target').value); if (done || token !== generation) return; let assetPath = options.asset;
          if (persist && field('save').checked && saveAsset) {const wav = await job('encode'); if (done || token !== generation) return; const saved = await saveAsset({path:field('asset').value,wav,settings:{...copy(edit),outputSampleRate:Number(field('rate').value),conversionTargets:{...conversionTargets,[defaultTarget]:field('target').value}},name:sourceName,source:sourceKind},{signal}); if (done || token !== generation) return; assetPath = saved?.assetPath ?? saved?.path ?? field('asset').value;}
          finish({...rendered,name:sourceName,source:sourceKind,assetPath});
        } catch(error) {if (!done && token === generation) {idle(); if (!dialog.open) dialog.showModal(); say(error.message,true);}}
      }
      use.addEventListener('click',() => {void useAudio();});
      for (const key of ['startFrame','endFrame','loopStartFrame','loopEndFrame','gainDb','fadeInSeconds','fadeOutSeconds','rootMidi','tuneCents','loopEnabled']) field(key).addEventListener('change',() => {
        if (!edit || busy) return; let value = key === 'loopEnabled' ? field(key).checked : Number(field(key).value); if (key.endsWith('Frame')) value = Math.round(value * audio.sampleRate); if (key.startsWith('fade')) value /= 1000;
        if (edit[key] === value) return;
        try {const next = normalizeSampleEdit(audio,{...edit,[key]:value}); remember(); apply(next);} catch(error) {say(error.message,true);}
      });
      for (const key of ['target','rate']) field(key).addEventListener('change',() => {generation++; stopPreview(); controls(); if (audio) use.disabled = false;});
      action('undo').addEventListener('click',() => {if (undo.length) {redo.push(copy(edit)); apply(undo.pop());}});
      action('redo').addEventListener('click',() => {if (redo.length) {undo.push(copy(edit)); apply(redo.pop());}});
      action('reset').addEventListener('click',() => {if (audio) {remember(); apply(createSampleEdit(audio));}});
      action('full').addEventListener('click',() => {if (audio) {viewport = [0,audio.channels[0].length]; update();}});
      action('zoom').addEventListener('click',() => {if (edit) {viewport = [edit.startFrame,edit.endFrame]; update();}});
      action('zoom-out').addEventListener('click',() => {if (audio) {const span = Math.min(audio.channels[0].length,(viewport[1]-viewport[0])*2), center = (viewport[0]+viewport[1])/2; viewport = [Math.max(0,Math.min(audio.channels[0].length-span,center-span/2)),0]; viewport[1] = viewport[0]+span; update();}});
      field('scroll').addEventListener('input',() => {if (audio) {const span = viewport[1]-viewport[0], start = (audio.channels[0].length-span)*Number(field('scroll').value)/1000; viewport = [start,start+span]; queueDraw();}});
      action('normalize').addEventListener('click',async () => {if (!edit) return; const token = generation; try {const gainDb = await job('normalize',{settings:edit}); if (!done && token === generation) {remember(); apply({...edit,gainDb}); say('Selected region normalized to leave headroom.');}} catch(error) {if (!done) say(error.message,true);}});
      action('pitch').addEventListener('click',async () => {
        if (!edit) return; const token = generation; say('Estimating pitch…');
        try {const result = await job('pitch',{settings:edit}); if (done || token !== generation) return; detected = result; action('apply-pitch').disabled = !Number.isFinite(result.midi);
          dialog.querySelector('[data-pitch]').textContent = result.hz ? `${noteName(Math.round(result.midi))} · ${result.hz.toFixed(2)} Hz · ${result.cents.toFixed(1)} cents · ${result.confidence} confidence. ${result.reason}` : result.reason; say('Pitch estimate ready. Accept it or keep your assigned root note.');
        } catch(error) {if (!done) say(error.message,true);}
      });
      action('apply-pitch').addEventListener('click',() => {if (detected?.hz) {remember(); apply({...edit,rootMidi:Math.round(detected.midi),tuneCents:detected.cents});}});
      action('cycle').addEventListener('click',() => {
        if (!edit) return; const hz = detected?.hz || 440*2**((edit.rootMidi-69+edit.tuneCents/100)/12), length = audio.channels[0].length, period = Math.min(length,Math.max(2,Math.round(audio.sampleRate/hz)));
        let first = Math.max(0,Math.min(length-period,edit.startFrame+Math.floor((edit.endFrame-edit.startFrame)/3))), end = Math.min(length-period,first+period*2);
        const samples = peaks.mono ?? audio.channels[0];
        for (let i = Math.max(1,first); i < end; i++) if (samples[i-1] <= 0 && samples[i] > 0) {first = i; break;}
        remember(); apply({...edit,startFrame:first,endFrame:first+period,loopEnabled:true,loopStartFrame:first,loopEndFrame:first+period,fadeInSeconds:0,fadeOutSeconds:0}); viewport = [edit.startFrame,edit.endFrame]; update();
      });
      action('new-wave').addEventListener('click',async () => {
        const token = ++generation; releaseCapture(); stopPreview(); lock(); const size = 256, rootMidi = 60, sampleRate = Math.round(440*2**((rootMidi-69)/12)*size), samples = Float32Array.from({length:size},(_,i) => .7*Math.sin(2*Math.PI*i/size));
        try {await installAudio({channels:[samples],sampleRate},'Drawn cycle','file',{rootMidi,loopEnabled:true},token); if (!done && token === generation) {field('tool').value = 'draw'; say('Draw a cycle in the waveform, then Use audio to play it with Guitar.');}} catch(error) {if (!done) failed(error);}
      });
      for (const [name,original] of [['preview-original',true],['preview',false]]) action(name).addEventListener('click',async () => {
        if (!edit) return; const token = generation; stopPreview(); const previewToken = previewSequence; say('Preparing preview…');
        try {const rendered = await prepared('original',original ? {...edit,gainDb:0,fadeInSeconds:0,fadeOutSeconds:0,drawPoints:[],drawStrokes:[]} : edit,!original); if (done || token !== generation || previewToken !== previewSequence) return;
          const context = await getAudioContext(); if (done || token !== generation || previewToken !== previewSequence) return;
          const buffer = context.createBuffer(rendered.channels.length,rendered.channels[0].length,rendered.sampleRate); rendered.channels.forEach((values,ch) => buffer.copyToChannel(values,ch));
          const node = context.createBufferSource(), gain = context.createGain(), current = preview = {node,gain,context}; node.buffer = buffer;
          node.loop = rendered.loopEnabled; node.loopStart = rendered.loopStartFrame / rendered.sampleRate; node.loopEnd = rendered.loopEndFrame / rendered.sampleRate;
          node.connect(gain); gain.connect(getPreviewDestination?.() ?? context.destination);
          gain.gain.setValueAtTime(0,context.currentTime); gain.gain.linearRampToValueAtTime(1,context.currentTime+.005);
          if (!node.loop && buffer.duration > .01) {gain.gain.setValueAtTime(1,context.currentTime+buffer.duration-.005);gain.gain.linearRampToValueAtTime(0,context.currentTime+buffer.duration);}
          node.onended = () => {node.disconnect(); gain.disconnect(); if (preview === current) preview = null;}; node.start();
          say(`Preview · peak ${rendered.peakBeforeClip.toFixed(3)} · ${rendered.clippedSamples} clipped samples. ${options.saveOnly ? 'Run a sampler example to play it with Keyboard.' : 'Use audio, then play the selected chip from Keyboard.'}`);
        } catch(error) {if (!done) say(error.message,true);}
      });
      action('silence').addEventListener('click',stopPreview);
      const position = event => {const rect = canvas.getBoundingClientRect(); return {frame:Math.max(0,Math.min(audio.channels[0].length,Math.round(viewport[0]+(event.clientX-rect.left)/rect.width*(viewport[1]-viewport[0])))),value:Math.max(-1,Math.min(1,(.5-(event.clientY-rect.top)/rect.height)*2))};};
      canvas.addEventListener('pointerdown',event => {
        if (!edit || busy) return; event.preventDefault(); stopPreview(); const point = position(event);
        if (field('tool').value === 'draw') {if (viewport[1]-viewport[0] > 8192) {say('Zoom in to 8192 samples or fewer to draw, or choose Draw a cycle.',true); return;} remember(); drag = {id:event.pointerId,points:[[point.frame,point.value]]};}
        else {
          remember(); const rect = canvas.getBoundingClientRect(), distance = 10/rect.width*(viewport[1]-viewport[0]);
          // Separate label rows keep coincident loop and selection markers reachable.
          const y = (event.clientY-rect.top)/rect.height*canvas.height;
          const candidates = edit.loopEnabled && y >= 18 && y <= 40 ? ['loopStartFrame','loopEndFrame'] : ['startFrame','endFrame'];
          const nearest = candidates.reduce((a,b) => Math.abs(edit[a]-point.frame) <= Math.abs(edit[b]-point.frame) ? a : b);
          drag = {id:event.pointerId,key:nearest,selection:Math.abs(edit[nearest]-point.frame) > distance,anchor:point.frame}; if (drag.selection) apply({...edit,startFrame:point.frame,endFrame:point.frame+1});
        }
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener('pointermove',event => {if (drag?.id !== event.pointerId) return; const point = position(event); if (drag.points) {if (drag.points.length < 8192) drag.points.push([Math.min(audio.channels[0].length-1,point.frame),point.value]); queueDraw();} else apply(drag.selection ? {...edit,startFrame:Math.min(drag.anchor,point.frame),endFrame:Math.max(drag.anchor,point.frame)+1} : {...edit,[drag.key]:point.frame});});
      const endDrag = event => {if (drag?.id !== event.pointerId) return; const current = drag; drag = null; if (current.points) apply({...edit,drawStrokes:[...(edit.drawStrokes ?? []),current.points]}); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);};
      canvas.addEventListener('pointerup',endDrag); canvas.addEventListener('pointercancel',endDrag);
      dialog.addEventListener('cancel',event => {event.preventDefault(); finish(null);}); dialog.addEventListener('close',() => finish(null));
      dialog.addEventListener('keydown',event => {event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {event.preventDefault(); action(event.shiftKey ? 'redo' : 'undo').click();}});
      signal?.addEventListener('abort',abort,{once:true}); doc.defaultView?.addEventListener('pagehide',abort,{once:true}); doc.addEventListener('visibilitychange',visibility);
      doc.body.append(dialog); idle(); queueDraw();
      async function open() {
        try {
          if (options.asset && loadAsset) {lock(); const saved = await loadAsset(options.asset,{signal}); if (done) return; if (saved) {await installAudio(await decodeSampleWav(saved.wav),saved.name ?? options.asset,saved.source ?? 'file',saved.settings); if (done) return; if (options.edit === false) {await useAudio(false); return;}} else idle();}
          dialog.showModal(); if (!available()) say('Microphone recording is unavailable here. Choose an audio file or draw a cycle.');
        } catch(error) {if (!done) {try {if (!dialog.open) dialog.showModal();} catch {} failed(error);}}
      }
      void open();
    });
  };
}
