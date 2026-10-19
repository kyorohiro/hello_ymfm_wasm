/** User-initiated audio input. Capture and decoding happen once, outside playback. */
export function createPlaygroundAudioInput({document:doc = globalThis.document, getAudioContext,
  mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder,
  recordingSeconds = 5} = {}) {
  let active = false;
  return function inputAudio(options = {}, {signal} = {}) {
    signal?.throwIfAborted();
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        options.title !== undefined && typeof options.title !== 'string') {
      return Promise.reject(new TypeError('inputAudio expects {title?: string}.'));
    }
    if (active) return Promise.reject(new Error('An audio input dialog is already open.'));
    active = true;
    return new Promise((resolve, reject) => {
      const previousFocus = doc.activeElement;
      const dialog = doc.createElement('dialog');
      dialog.className = 'playground-settings-dialog';
      dialog.dataset.audioInput = '';
      dialog.setAttribute('aria-label', 'Audio input');
      dialog.style.width = 'min(32rem, calc(100vw - 2rem))';
      const title = doc.createElement('h2');
      title.textContent = options.title || 'Choose or record audio';
      const description = doc.createElement('p');
      description.textContent = 'Choose an audio file, or record a short sound with your microphone.';
      const label = doc.createElement('label');
      label.textContent = 'Audio file ';
      const file = doc.createElement('input');
      file.type = 'file'; file.accept = 'audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a,.webm';
      file.dataset.audioFile = ''; label.append(file);
      const actions = doc.createElement('p');
      const button = (text, name) => {
        const node = doc.createElement('button'); node.type = 'button'; node.textContent = text;
        node.dataset.audioAction = name; return node;
      };
      const record = button('Record microphone', 'record');
      const stop = button('Finish recording', 'stop'); stop.hidden = true;
      actions.append(record, ' ', stop);
      const status = doc.createElement('p'); status.setAttribute('role', 'status');
      status.dataset.audioInputStatus = '';
      const footer = doc.createElement('p');
      const cancel = button('Cancel', 'cancel');
      const use = button('Use audio', 'use'); use.disabled = true;
      footer.append(cancel, ' ', use);
      dialog.append(title, description, label, actions, status, footer);
      let done = false, generation = 0, selected = null, stream = null, recorder = null, timer = null;
      let recording = false;
      const stopTracks = () => {stream?.getTracks().forEach(track => track.stop()); stream = null;};
      const releaseCapture = () => {
        clearTimeout(timer); timer = null;
        const current = recorder; recorder = null;
        if (current && current.state !== 'inactive') {try {current.stop();} catch {}}
        stopTracks(); recording = false;
      };
      const finish = (value, error) => {
        if (done) return;
        done = true; generation++;
        releaseCapture();
        signal?.removeEventListener('abort', abort);
        doc.defaultView?.removeEventListener('pagehide', abort);
        doc.removeEventListener('visibilitychange', visibility);
        if (dialog.open) dialog.close();
        dialog.remove(); active = false;
        if (previousFocus?.isConnected) previousFocus.focus();
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(null, signal?.reason ?? new DOMException('Audio input cancelled', 'AbortError'));
      const available = () => Boolean(mediaDevices?.getUserMedia && Recorder);
      const idle = () => {
        file.disabled = false; record.disabled = !available(); record.hidden = false;
        stop.hidden = true; use.disabled = !selected;
      };
      const failed = error => {
        releaseCapture(); selected = null; idle();
        status.textContent = `Could not read audio: ${error.message ?? error}`;
      };
      const decode = async (blob, name, source, token) => {
        const bytes = await blob.arrayBuffer();
        if (done || token !== generation) return;
        const context = await getAudioContext();
        if (done || token !== generation) return;
        const buffer = await context.decodeAudioData(bytes);
        if (done || token !== generation) return;
        if (!buffer.length || !buffer.numberOfChannels) throw new Error('The audio is empty.');
        selected = {name, source, sampleRate:buffer.sampleRate,
          channels:Array.from({length:buffer.numberOfChannels}, (_,channel) => new Float32Array(buffer.getChannelData(channel)))};
        status.textContent = `${name} · ${buffer.duration.toFixed(2)} seconds. Ready to use.`;
        idle(); use.focus();
      };
      file.addEventListener('change', async () => {
        const chosen = file.files?.[0]; if (!chosen) return;
        const token = ++generation; selected = null; releaseCapture();
        file.disabled = record.disabled = use.disabled = true;
        status.textContent = 'Reading audio…';
        try {
          if (chosen.size > 16 * 1024 * 1024) throw new Error('Choose a file smaller than 16 MiB.');
          await decode(chosen, chosen.name, 'file', token);
        } catch (error) {if (!done && token === generation) failed(error);}
      });
      const stopRecording = () => {
        if (!recorder || recorder.state === 'inactive') return;
        clearTimeout(timer); timer = null;
        stop.disabled = true; recording = false;
        status.textContent = 'Preparing recording…';
        try {recorder.stop();} catch (error) {failed(error);}
        stopTracks();
      };
      record.addEventListener('click', async () => {
        const token = ++generation; selected = null;
        file.disabled = record.disabled = use.disabled = true;
        status.textContent = 'Waiting for microphone access…';
        try {
          const capture = await mediaDevices.getUserMedia({audio:{channelCount:1,
            echoCancellation:false, noiseSuppression:false, autoGainControl:false}});
          if (done || token !== generation) {capture.getTracks().forEach(track => track.stop()); return;}
          stream = capture;
          const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
            .find(type => Recorder.isTypeSupported?.(type));
          const current = recorder = new Recorder(stream, mimeType ? {mimeType} : {});
          const chunks = [];
          current.addEventListener('dataavailable', event => {if (event.data?.size) chunks.push(event.data);});
          current.addEventListener('error', event => {
            if (!done && token === generation) {generation++; failed(event.error ?? new Error('Recording failed.'));}
          });
          current.addEventListener('stop', async () => {
            if (done || token !== generation) return;
            stopTracks();
            recorder = null; clearTimeout(timer); timer = null;
            file.disabled = record.disabled = use.disabled = true;
            try {
              const blob = new Blob(chunks, {type:current.mimeType || mimeType || 'audio/webm'});
              if (!blob.size) throw new Error('No audio was recorded.');
              await decode(blob, 'Microphone recording', 'microphone', token);
            } catch (error) {if (!done && token === generation) failed(error);}
          }, {once:true});
          current.start(); recording = true; record.hidden = true; stop.hidden = false; stop.disabled = false;
          status.textContent = `Recording… Finish when ready (up to ${recordingSeconds} seconds).`;
          timer = setTimeout(stopRecording, recordingSeconds * 1000); stop.focus();
        } catch (error) {if (!done && token === generation) failed(error);}
      });
      const visibility = () => {if (doc.hidden && recording) stopRecording();};
      stop.addEventListener('click', stopRecording);
      cancel.addEventListener('click', () => finish(null));
      use.addEventListener('click', () => {if (selected) finish(selected);});
      dialog.addEventListener('cancel', event => {event.preventDefault(); finish(null);});
      dialog.addEventListener('close', () => finish(null));
      dialog.addEventListener('keydown', event => event.stopPropagation());
      signal?.addEventListener('abort', abort, {once:true});
      doc.defaultView?.addEventListener('pagehide', abort, {once:true});
      doc.addEventListener('visibilitychange', visibility);
      doc.body.append(dialog);
      idle();
      if (!available()) status.textContent = 'Microphone recording is unavailable here. You can choose an audio file.';
      try {dialog.showModal();} catch (error) {finish(null, error);}
    });
  };
}
