import {normalizeSampleEdit, renderSampleEdit, renderGameboyWave, sampleNormalizationGainDb,
  estimateSamplePitch, encodeSampleWav} from '../js/playground_sample_edit.js?v=audio-numeric-bindings-1';
import {renderGameboySampleComparison, renderGameboySamplePreview} from '../js/playground_sample_gameboy_preview.js?v=gameboy-sample-preview-1';
import {renderPs1Sample, renderPs1SampleComparison} from '../js/playground_sample_ps1.js?v=ps1-sample-editor-1';
import {renderPs1SamplePreview} from '../js/playground_sample_ps1_preview.js?v=ps1-pcm-waveform-1';

// Conversion results may contain aliased typed-array views. Transfer each
// backing buffer once; the Worker retains only the original source recording.
function transferBuffers(value, buffers = new Set()) {
  if (value instanceof ArrayBuffer) buffers.add(value);
  else if (ArrayBuffer.isView(value)) {if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);}
  else if (value && typeof value === 'object') for (const item of Object.values(value)) transferBuffers(item, buffers);
  return [...buffers];
}

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
      else if (command === 'gameboy-wave') value = renderGameboySampleComparison(audio, settings);
      else if (command === 'ps1-comparison') value = renderPs1SampleComparison(audio, settings);
      else if (command === 'gameboy-preview') {
        const source = audio, edit = normalizeSampleEdit(source, settings);
        const {default: moduleFactory} = await import('../generated/gameboy_apu_wasm.js');
        value = await renderGameboySamplePreview(source, edit, {moduleFactory});
      }
      else if (command === 'ps1-preview') {
        // Capture the source/edit before loading WASM: a later message can
        // replace the recording while this asynchronous import is pending.
        const source = audio, edit = normalizeSampleEdit(source, settings);
        const {default: moduleFactory} = await import('../generated/ps1_spu_wasm.js?v=ps1-mode-1');
        value = await renderPs1SamplePreview(source, edit, {moduleFactory});
      }
      else if (command === 'render') {
        const target = options.target ?? 'original';
        const edit = normalizeSampleEdit(audio, settings);
        if (target === 'ps1') {
          // Raw decoded PCM is used for comparison only. Avoid copying another
          // sample-sized buffer into runtime / logic-Worker inputAudio results.
          const {decodedChannels, ...converted} = renderPs1Sample(audio, edit);
          value = converted;
        } else value = renderSampleEdit(audio, edit, {sampleRate: options.sampleRate ?? audio.sampleRate,
          mono: options.mono ?? true, ...(target === 'rf5c164' ? {maxFrames:65504} : {})});
        value.target = target;
        if (target === 'gameboy-wave') value.waveform = renderGameboyWave(audio, edit);
      } else throw new Error('Unknown sample editor operation.');
    }
    self.postMessage({id, value}, transferBuffers(value));
  } catch (error) {self.postMessage({id, error:error.message});}
};
