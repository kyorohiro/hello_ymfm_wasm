// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {encodePs1Adpcm} from '../js/ps1_adpcm_encoder.js';
self.onmessage = ({data}) => {
  try {
    const result = encodePs1Adpcm(data.pcm, data.options);
    self.postMessage({result}, [result.adpcm.buffer]);
  } catch (error) { self.postMessage({error:error.message}); }
};
