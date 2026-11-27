// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';
import {SongSampleMemory, decodeSongSample} from '../synth-cps1/song-samples.js';
import {drawWave} from '../synth-cps1/sample-view.js';
import {encodeStereoWav} from './vgm_wav.js';

// Follow the audible cursor independently of the player's queued writes. Only
// advance the ADPCM cursors here. Decode a waveform when a voice is inspected.
export function createOki6295Cursor(buffer) {
  const parser = new Ym2612VGM(buffer, {logger:null});
  const chip = new Oki6295AudioEngine({clock:parser.header.okim6295Clock});
  const hits = Array(4).fill(null);
  let memory = new SongSampleMemory(), sharedRom = false;
  let time = 0, next = 0, loopStart = -1;

  function advance(to) {
    chip.phase += (to - time) * chip.clock / ((chip.pin7 ? 132 : 165) * 44100);
    const ticks = Math.floor(chip.phase);
    chip.phase -= ticks;
    for (const voice of chip.voices) {
      if (!voice.playing) continue;
      voice.cursor += ticks;
      if (voice.cursor >= voice.count) voice.playing = false;
    }
    time = to;
  }

  function loadRom(event) {
    if (sharedRom) {
      if (chip.rom.length === event.memorySize) chip.rom = chip.rom.slice();
      const previous = memory;
      memory = new SongSampleMemory();
      memory.size = previous.size;
      memory.ranges = previous.ranges.map(range => range.slice());
      sharedRom = false;
    }
    chip.loadOki6295Rom(event.data, event.offset, event.memorySize);
    memory.observe(event.offset, event.data.length, event.memorySize);
  }

  function command(register, value) {
    const triggering = register === 0 && chip.pending >= 0;
    const busy = triggering ? chip.readStatus() : 0;
    chip.writeOki6295(register, value);
    if (!triggering) return;
    chip.voices.forEach((voice, i) => {
      if ((busy & (1 << i)) || !voice.playing) return;
      const mapping = {rom:chip.rom, bank:chip.bank, nmkMode:chip.nmkMode,
        nmkBanks:chip.nmkBanks.slice(), romOffset:chip.romOffset};
      const {sample, attenuation, start, count} = voice;
      const supplied = memory;
      sharedRom = true;
      hits[i] = {sample, attenuation, time, rate:chip.clock / (chip.pin7 ? 132 : 165),
        address:mapping.romOffset(start),
        bytes:() => supplied.sampleBytes(mapping, sample * 8, 6) && supplied.sampleBytes(mapping, start, count / 2)};
    });
  }

  return {chip, hits, get time() {return time;},
    seek(target, looping = false, budget = 32768) {
      while (next <= target && budget-- > 0) {
        if (parser.ended) {
          if (!looping || loopStart < 0 || next <= loopStart) break;
          parser.position = parser.header.loopOffset;
          parser.ended = false;
        }
        advance(next);
        if (parser.hasLoop() && parser.position === parser.header.loopOffset) loopStart = next;
        const event = parser.step();
        if (event.type === 'wait') next += event.samples;
        else if (!event.chipIndex && event.type === 'okim6295-rom-data') loadRom(event);
        else if (!event.chipIndex && event.type === 'okim6295-write') command(event.register, event.value);
      }
      if (budget < 0) return false;
      advance(target);
      return true;
    }};
}

export function mountOki6295Monitor(root) {
  root.innerHTML = '<div class="fm-channels" role="group" aria-label="Inspect MSM6295 voice"></div><p></p><canvas width="640" height="96" style="max-width:100%" aria-label="MSM6295 sample waveform" hidden></canvas><audio controls hidden></audio>';
  const group = root.querySelector('div'), caption = root.querySelector('p');
  const canvas = root.querySelector('canvas'), audio = root.querySelector('audio');
  let buffer, cursor, failure, selected = 0, preview, url;
  function clearPreview() {
    if (url) {
      audio.pause(); audio.removeAttribute('src'); audio.load();
      URL.revokeObjectURL(url); url = null;
    }
    canvas.hidden = audio.hidden = true;
    preview = undefined;
  }
  function inspect(hit) {
    if (preview === hit) return;
    clearPreview();
    preview = hit;
    if (!hit) {caption.textContent = 'No sample started on this voice.'; return;}
    const bytes = hit.bytes();
    caption.textContent = 'Sample ' + hit.sample + ' · Start ROM address 0x' + hit.address.toString(16).toUpperCase();
    if (!bytes) {caption.textContent += ' · Incomplete ROM data'; return;}
    const wave = decodeSongSample({bytes, attenuation:hit.attenuation}, canvas.width);
    drawWave(canvas, wave.min, wave.max);
    url = URL.createObjectURL(new Blob([encodeStereoWav(wave.pcm, wave.pcm, Math.round(hit.rate))], {type:'audio/wav'}));
    audio.src = url;
    canvas.hidden = audio.hidden = false;
  }
  const buttons = Array.from({length:4}, (_, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.onclick = () => {selected = i; update();};
    group.append(button);
    return button;
  });
  let position = 0, playing = false, looping = false;
  function update() {
    if (!buffer || failure) return;
    try {
      if (!cursor || position < cursor.time) cursor = createOki6295Cursor(buffer);
      if (!cursor.seek(position, looping)) {clearPreview(); caption.textContent = 'Reading sample commands…'; return;}
      buttons.forEach((button, i) => {
        const hit = cursor.hits[i];
        const label = 'Voice ' + (i+1) + (hit ? ' · Sample ' + hit.sample + ' · Att ' + hit.attenuation : ' · —');
        if (button.textContent !== label) button.textContent = label;
        button.setAttribute('aria-pressed', String(selected === i));
        button.classList.toggle('is-key-on', cursor.chip.voices[i].playing);
        button.classList.toggle('oki-recent-start', !!hit && position-hit.time < 6615);
      });
      if (!playing) inspect(cursor.hits[selected]);
      else {
        if (preview !== undefined) clearPreview();
        caption.textContent = 'Pause to inspect the selected sample.';
      }
    } catch (error) {failure = true; clearPreview(); caption.textContent = error.message;}
  }
  return {
    load(value) {clearPreview(); buffer = value; cursor = null; failure = false; selected = position = 0; playing = false;},
    render(sample, active, loop) {
      position = Math.max(0, Math.floor(sample)); playing = active; looping = loop; update();
    },
    hide() {if (!audio.paused) audio.pause();},
  };
}
