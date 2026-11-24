// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmA} from '../js/adpcm_a_sample.js';
import {renderSampleEdit} from '../js/playground_sample_edit.js';

self.onmessage = ({data: {audio, rate, maxBytes}}) => {
  try {
    const maxFrames = maxBytes * 2;
    const frames = Math.max(1, Math.round(audio.channels[0]?.length * rate / audio.sampleRate));
    if (frames > maxFrames) {
      throw new RangeError(`ADPCM-A samples can be up to ${(maxFrames / rate).toFixed(2)} seconds.`);
    }
    // The shared resampler accepts integer rates. Use the chip's fractional
    // playback rate for the sample length and address boundary.
    const sampleRate = Math.ceil(rate);
    const {channels: [mono]} = renderSampleEdit(audio, {}, {
      sampleRate, maxFrames: Math.ceil(maxFrames * sampleRate / rate),
    });
    const {bytes} = encodeAdpcmA(mono.subarray(0, frames), {maxBytes});
    self.postMessage({bytes}, [bytes.buffer]);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
