// SPDX-License-Identifier: BSD-3-Clause
import { visitAdpcmAFrames } from '../js/adpcm_a_sample.js';

/** Min/max pairs for the first decoded pass, before hardware level and pan. */
export function summarizeFm2610AdpcmA(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected ADPCM-A bytes');
  const frames = bytes.length * 2;
  const columns = Math.min(768, frames);
  const peaks = new Float32Array(columns * 2);
  if (!columns) return peaks;
  let column = 0, end = Math.floor(frames / columns);
  let low = Infinity, high = -Infinity;
  visitAdpcmAFrames(bytes, (sample, frame) => {
    low = Math.min(low, sample);
    high = Math.max(high, sample);
    if (frame + 1 !== end) return;
    peaks[column * 2] = low;
    peaks[column * 2 + 1] = high;
    column++;
    end = Math.floor((column + 1) * frames / columns);
    low = Infinity;
    high = -Infinity;
  });
  return peaks;
}

export async function getFm2610AdpcmAWaveform(bytes, signal, {transfer = false} = {}) {
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected ADPCM-A bytes');
  if (bytes.length <= 0x10000 || typeof Worker !== 'function') return summarizeFm2610AdpcmA(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./song_adpcm_a_waveform_worker.js', import.meta.url), {type: 'module'});
    function close() {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    }
    function abort() {
      close();
      reject(signal.reason);
    }
    signal?.addEventListener('abort', abort, {once: true});
    worker.onmessage = ({data}) => {
      close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.peaks);
    };
    worker.onerror = event => {
      close();
      reject(new Error(event.message || 'Could not decode the ADPCM-A waveform.'));
    };
    try {
      worker.postMessage(bytes, transfer ? [bytes.buffer] : []);
    } catch (error) {
      close();
      reject(error);
    }
  });
}
