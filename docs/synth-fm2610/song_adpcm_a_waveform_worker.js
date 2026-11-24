// SPDX-License-Identifier: BSD-3-Clause
import { summarizeFm2610AdpcmA } from './song_adpcm_a_waveform.js';

self.onmessage = ({data}) => {
  try {
    const peaks = summarizeFm2610AdpcmA(data);
    self.postMessage({peaks}, [peaks.buffer]);
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
