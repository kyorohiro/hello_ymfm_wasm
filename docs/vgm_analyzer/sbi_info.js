import {createPlaygroundOperatorKeyboard} from '../playground/playground_operator_keyboard.js?v=midi-1';
import {extractSbiPatches, SBI_NOTICE} from './sbi_export.js';
import {Ymf262, YMF262_CLOCK} from '../js/ymf262.js';

export function midiToSbiPitch(midi) {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  for (let block = 0; block < 8; block++) {
    const fnum = Math.round(frequency * 2 ** (20 - block) / (YMF262_CLOCK / 288));
    if (Number.isFinite(fnum) && fnum > 0 && fnum <= 1023) return {fnum, block};
  }
  throw new RangeError('Note outside OPL3 pitch range');
}

function writeRegister(chip, address, value) {
  chip.write(address >= 256 ? 2 : 0, address & 255);
  chip.write(address >= 256 ? 3 : 1, value);
}

export function writeSbiPreview(chip, patch, midi = 69) {
  const pitch = midiToSbiPitch(midi);
  chip.reset();
  writeRegister(chip, 0x105, 1);
  writeRegister(chip, 0x104, patch.fourOp ? 1 : 0);
  for (let pair = 0; pair < (patch.fourOp ? 2 : 1); pair++) {
    const start = 36 + pair * 11, slot = pair * 8;
    for (const [index, base] of [0x20,0x40,0x60,0x80,0xe0].entries()) {
      writeRegister(chip, base + slot, patch.data[start + index * 2]);
      writeRegister(chip, base + slot + 3, patch.data[start + index * 2 + 1]);
    }
    writeRegister(chip, 0xc0 + pair * 3, 0x30 | patch.data[start + 10]);
  }
  writeRegister(chip, 0xa0, pitch.fnum & 255);
  const keyOff = (pitch.block << 2) | (pitch.fnum >> 8);
  writeRegister(chip, 0xb0, keyOff | 32);
  return keyOff;
}

export function describeSbiVoice(patch) {
  const lines = [`${patch.fourOp ? '4op (UNIX SBI)' : '2op (SBI)'} · Feedback ${(patch.data[46] >> 1) & 7}`];
  for (let pair = 0; pair < (patch.fourOp ? 2 : 1); pair++) {
    const start = 36 + pair * 11;
    lines.push(`Pair ${pair + 1} connection: ${patch.data[start + 10] & 1}`);
    for (let operator = 0; operator < 2; operator++) {
      const characteristics = patch.data[start + operator], level = patch.data[start + 2 + operator];
      const attackDecay = patch.data[start + 4 + operator], sustainRelease = patch.data[start + 6 + operator];
      lines.push(`OP${pair * 2 + operator + 1}: MUL ${characteristics & 15} · TL ${level & 63} · AR ${attackDecay >> 4} / DR ${attackDecay & 15} / SL ${sustainRelease >> 4} / RR ${sustainRelease & 15} · KSL ${level >> 6} / KSR ${(characteristics >> 4) & 1} · AM ${(characteristics >> 7) & 1} / VIB ${(characteristics >> 6) & 1} / EG ${(characteristics >> 5) & 1} · WAVE ${patch.data[start + 8 + operator]}`);
    }
  }
  return lines.join('\n');
}

export function createSbiKeyboardAudio(chip, context, getPatch, getVolume) {
  const gain = context.createGain();
  gain.connect(context.destination);
  const sources = new Set();
  let timer = null, next = 0, releaseUntil = Infinity, keyOff = 0;
  function stop() {
    clearTimeout(timer); timer = null;
    for (const source of sources) { source.stop(); source.disconnect(); }
    sources.clear();
    writeRegister(chip, 0xb0, keyOff);
  }
  function pump() {
    if (context.currentTime >= releaseUntil) { stop(); return; }
    const rate = chip.sampleRate(YMF262_CLOCK), frames = Math.round(rate * 0.02);
    next = Math.max(next, context.currentTime);
    gain.gain.value = getVolume();
    while (next < context.currentTime + 0.06) {
      const pcm = chip.generateStereo(frames), buffer = context.createBuffer(2, frames, rate);
      buffer.getChannelData(0).set(pcm.left); buffer.getChannelData(1).set(pcm.right);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(gain);
      sources.add(source); source.onended = () => { sources.delete(source); source.disconnect(); };
      source.start(next); next += frames / rate;
    }
    timer = setTimeout(pump, 20);
  }
  return {
    noteOnMidi(_channel, midi) {
      stop(); const patch = getPatch(); if (!patch) return;
      keyOff = writeSbiPreview(chip, patch, midi);
      releaseUntil = Infinity; next = context.currentTime; pump();
    },
    noteOff() { writeRegister(chip, 0xb0, keyOff); releaseUntil = context.currentTime + 2; },
    stop,
    dispose() { stop(); gain.disconnect(); },
  };
}

export function mountSbiInfo({root, onStatus, createKeyboard = createPlaygroundOperatorKeyboard,
  createContext = () => new AudioContext(), createChip = async () => {
    const {default:moduleFactory} = await import('../generated/ymf262_wasm.js');
    return Ymf262.create({moduleFactory});
  }}) {
  root.innerHTML = `<div class="tfi-info-toolbar"><label>SBI voice <select aria-label="SBI info voice"></select></label>
    <button class="sbi-stop" type="button">Stop audition</button><button class="sbi-save" type="button" disabled>Download SBI</button>
    <label>Audition volume <input type="range" min="0" max="100" value="30"></label></div>
    <p>Voice history, deduplicated per channel. Held-key writes include intermediate settings. Hold a keyboard key to audition; release to key off (up to two seconds of release). VGM playback continues. Preview is monophonic, using the exported SBI on OPL3 at 14.31818 MHz with centered output.</p>
    <p class="sbi-notice"></p><section class="tfi-info-editor">
      <p class="sbi-detail"></p><pre class="sbi-voice" style="white-space:pre-wrap"></pre>
      <h3>Keyboard</h3><div class="tfi-info-keyboard" aria-label="Audition keyboard" hidden></div></section>`;
  root.querySelector('.sbi-notice').textContent = SBI_NOTICE;
  const select = root.querySelector('select'), save = root.querySelector('.sbi-save');
  let buffer = null, patches = null, chip = null, context = null, audio = null, ready = null, visible = false, disposed = false;
  const selected = () => patches?.[Number(select.value)];
  const keyboard = createKeyboard({root:root.querySelector('.tfi-info-keyboard'), channelCount:1, getSelectedChannel:() => 0, idPrefix:'sbi-', onStatus,
    async ensureAudioReady() {
      if (disposed) return;
      if (!ready) ready = (async () => {
        context ??= createContext(); await context.resume();
        chip = await createChip();
        if (disposed) { chip.dispose(); chip = null; return; }
        audio = createSbiKeyboardAudio(chip, context, selected, () => Number(root.querySelector('input').value) / 100);
        keyboard.attachSynth(audio);
      })().catch(error => { ready = null; throw error; });
      await ready;
    },
  });
  function stop() { keyboard.setView('code'); audio?.stop(); }
  function showKeyboard() { keyboard.setView(visible && selected() ? 'operator' : 'code'); }
  function refresh() {
    const patch = selected(); save.disabled = !patch;
    root.querySelector('.sbi-detail').textContent = patch ? `${patch.name} · CH${patch.channel + 1} · First observed ${(patch.sample / 44100).toFixed(3)} s` : 'Load an OPL VGM to inspect SBI voices.';
    root.querySelector('.sbi-voice').textContent = patch ? describeSbiVoice(patch) : '';
    showKeyboard();
  }
  function extract() {
    if (patches || !buffer) return;
    try {
      patches = extractSbiPatches(buffer); select.replaceChildren();
      patches.forEach((patch, index) => {
        const option = document.createElement('option'); option.value = String(index);
        option.textContent = `${patch.name} · ${patch.fourOp ? '4op' : '2op'} · ${(patch.sample / 44100).toFixed(3)} s`; select.append(option);
      });
      if (patches.length) select.value = '0';
      refresh();
      if (!patches.length) root.querySelector('.sbi-detail').textContent = 'No keyed melodic OPL voices found.';
    } catch (error) {
      patches = []; refresh();
      root.querySelector('.sbi-detail').textContent = `SBI extraction failed: ${error.message}`;
      onStatus(`SBI extraction failed: ${error.message}`);
    }
  }
  select.addEventListener('change', () => { stop(); refresh(); select.blur(); });
  root.querySelector('.sbi-stop').addEventListener('click', () => { stop(); showKeyboard(); });
  save.addEventListener('click', () => {
    const patch = selected(); if (!patch) return;
    const url = URL.createObjectURL(new Blob([patch.data], {type:'application/octet-stream'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = patch.name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return {
    loadVgm(value) { stop(); buffer = value; patches = null; select.replaceChildren(); refresh(); if (visible) extract(); },
    setVisible(value) { root.hidden = !value; if (visible === value) return; visible = value; if (value) { extract(); showKeyboard(); } else stop(); },
    async dispose() { disposed = true; keyboard.dispose(); await ready?.catch(() => {}); audio?.dispose(); chip?.dispose(); chip = null; await context?.close(); },
  };
}
