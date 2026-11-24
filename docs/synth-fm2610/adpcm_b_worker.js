// SPDX-License-Identifier: BSD-3-Clause
import { drawFm2610AdpcmB, encodeFm2610AdpcmB, exportFm2610AdpcmBWav, summarizeFm2610AdpcmB } from './adpcm_b.js';

self.onmessage = ({data: {audio, sampleRate, bytes, points, wavRate}}) => {
  try {
    let result;
    if (points) result = drawFm2610AdpcmB(bytes, points);
    else if (wavRate !== undefined) result = exportFm2610AdpcmBWav(bytes, wavRate);
    else result = bytes ? summarizeFm2610AdpcmB(bytes) : encodeFm2610AdpcmB(audio, sampleRate);
    self.postMessage({result}, result ? [result.buffer] : []);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
