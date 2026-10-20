import {normalizeSampleEdit, renderSampleEdit, renderGameboyWave, sampleNormalizationGainDb,
  estimateSamplePitch, encodeSampleWav} from '../js/playground_sample_edit.js?v=dx7-voices-1';

let audio = null;
self.onmessage = async ({data}) => {
  const {id, command, settings, options = {}} = data;
  try {
    let value;
    if (command === 'source') {
      audio = data.audio;
      const samples = audio.channels.length === 1 ? audio.channels[0]
        : Float32Array.from(audio.channels[0], (value,i) => (value + audio.channels[1][i]) * .5);
      const bins = Math.ceil(samples.length / 128);
      value = {low:new Float32Array(bins).fill(1), high:new Float32Array(bins).fill(-1)};
      if (audio.channels.length > 1) value.mono = samples;
      for (let i = 0; i < samples.length; i++) {
        const bin = i >> 7;
        value.low[bin] = Math.min(value.low[bin], samples[i]);
        value.high[bin] = Math.max(value.high[bin], samples[i]);
      }
    }
    else {
      if (!audio) throw new Error('Choose or record audio first.');
      if (command === 'pitch') value = estimateSamplePitch(audio, settings);
      else if (command === 'normalize') value = sampleNormalizationGainDb(audio, settings);
      else if (command === 'encode') value = encodeSampleWav(audio);
      else if (command === 'render') {
        const target = options.target ?? 'original';
        const edit = normalizeSampleEdit(audio, settings);
        value = renderSampleEdit(audio, edit, {sampleRate: options.sampleRate ?? audio.sampleRate,
          mono: options.mono ?? true, ...(target === 'rf5c164' ? {maxFrames:65504} : {})});
        value.target = target;
        if (target === 'gameboy-wave') value.waveform = renderGameboyWave(audio, edit);
      } else throw new Error('Unknown sample editor operation.');
    }
    const transfer = [];
    if (value instanceof Uint8Array) transfer.push(value.buffer);
    for (const channel of value?.channels ?? []) transfer.push(channel.buffer);
    if (value?.waveform) transfer.push(value.waveform.buffer);
    if (value?.low) transfer.push(value.low.buffer, value.high.buffer);
    if (value?.mono) transfer.push(value.mono.buffer);
    self.postMessage({id, value}, transfer);
  } catch (error) {self.postMessage({id, error:error.message});}
};
