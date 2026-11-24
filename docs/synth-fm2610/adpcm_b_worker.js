// SPDX-License-Identifier: BSD-3-Clause
import { encodeFm2610AdpcmB, summarizeFm2610AdpcmB } from './adpcm_b.js';

self.onmessage = ({data: {audio, sampleRate, bytes}}) => {
  try {
    const result = bytes ? summarizeFm2610AdpcmB(bytes) : encodeFm2610AdpcmB(audio, sampleRate);
    self.postMessage({result}, [result.buffer]);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
