// Run → choose a file or record your voice → click outside Code → play A W S E D F T G Y H U J K.
// Run → 音声ファイルかマイク録音を選択 → Code の外をクリックして A W S E D F ... を演奏。
// C4 plays the original recording speed; this example does not detect its pitch.
// Mega-CD RF5C164: 8 voices share 64 KiB of 8-bit sample RAM.
const sourceNote = 60; // MIDI C4. Change this if your recording has another root note.
const startSeconds = 0; // Choose the useful part of a longer recording.
const maxSeconds = 3;
const sampleRate = 16000; // Lower rates save RAM and give a rougher PCM sound.
const volume = 72; // 0..255 per voice; leave headroom for all eight voices.

const audio = await inputAudio({title: 'Choose a Mega-CD sample'});
if (audio) {
  const pcm = await useSoundChip('rf5c164');
  const prepared = prepareSample(audio, startSeconds, maxSeconds, sampleRate);
  const sample = await pcm.loadSample(prepared, {address: 0});
  const voices = Array.from({length: 8}, (_, channel) => ({
    channel, owner: null, queue: Promise.resolve(),
  }));
  const held = new Map();
  let active = true;
  let age = 0;
  const keys = {
    KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65,
    KeyT: 66, KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71,
    KeyK: 72, KeyO: 73, KeyL: 74, KeyP: 75, Semicolon: 76,
  };

  liveCleanup(['megacd-sampler'], async () => {
    active = false;
    held.clear();
    for (const voice of voices) voice.owner = null;
    // Send silence now; queued old callbacks must never touch a later Run.
    await Promise.all(voices.map(voice => pcm.keyOff(voice.channel)));
  });

  onKeyboardPressKey('megacd-sampler', async event => {
    const note = keys[event.code];
    if (!active || event.editable || note === undefined || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (held.has(event.code)) return;
    // Reuse a free voice, or steal the oldest held note when all eight are busy.
    const voice = voices.find(v => !v.owner) ?? voices.reduce((a, b) => a.owner.age < b.owner.age ? a : b);
    if (voice.owner) held.delete(voice.owner.key);
    const owner = {key: event.code, age: ++age};
    voice.owner = owner;
    held.set(event.code, {voice, owner});
    const step = Math.max(1, Math.min(65535, Math.round(sample.step * 2 ** ((note - sourceNote) / 12))));
    // One FIFO per voice prevents a quick release/steal from reviving an old note.
    voice.queue = voice.queue.then(async () => {
      if (!active || voice.owner !== owner) return;
      await pcm.keyOff(voice.channel);
      if (!active || voice.owner !== owner) return;
      await pcm.setChannel(voice.channel, {
        ...sample, step, volume,
        pan: voice.channel % 2 ? {left: 11, right: 15} : {left: 15, right: 11},
      });
      if (active && voice.owner === owner) await pcm.keyOn(voice.channel);
    });
    await voice.queue;
  });

  onKeyboardReleaseKey('megacd-sampler', async event => {
    const pressed = held.get(event.code);
    if (!pressed) return;
    held.delete(event.code);
    if (pressed.voice.owner !== pressed.owner) return;
    pressed.voice.owner = null;
    pressed.voice.queue = pressed.voice.queue.then(() => {
      if (active) return pcm.keyOff(pressed.voice.channel);
    });
    await pressed.voice.queue;
  });

  log(`${audio.name}: ${prepared.channels[0].length} / 65533 sample bytes, ${prepared.sampleRate} Hz, 8 voices.`);
  log('Play A W S E D F T G Y H U J K O L P ; outside Code. Release a key to stop its voice.');
} else {
  log('No sample selected. Run again to choose a sound.');
}

// Mix to mono, crop, and fit RAM before RF5C164 converts it to sign-magnitude PCM.
// Filtering happens once here, never on keyboard events or a display frame.
function prepareSample(audio, startSeconds, maxSeconds, targetRate) {
  const first = Math.min(audio.channels[0].length - 1, Math.max(0, Math.floor(startSeconds * audio.sampleRate)));
  const available = Math.min(audio.channels[0].length - first, Math.floor(maxSeconds * audio.sampleRate));
  const frames = Math.min(65533, Math.max(1, Math.floor(available * targetRate / audio.sampleRate)));
  const mono = new Float32Array(available);
  for (const channel of audio.channels) {
    for (let i = 0; i < available; i++) mono[i] += channel[first + i] / audio.channels.length;
  }
  const output = new Float32Array(frames);
  const ratio = audio.sampleRate / targetRate;
  const cutoff = Math.min(1, 1 / ratio) * 0.9;
  const radius = 12 / cutoff;
  const fade = Math.min(Math.round(targetRate * 0.005), Math.floor(frames / 2));
  for (let i = 0; i < frames; i++) {
    const position = i * ratio;
    let value = 0, weights = 0;
    // Windowed sinc reduces aliasing when shrinking a high-rate recording.
    for (let j = Math.max(0, Math.ceil(position - radius)); j < Math.min(available, position + radius); j++) {
      const distance = j - position;
      const x = Math.PI * distance * cutoff;
      const weight = (x === 0 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * distance / radius));
      value += mono[j] * weight;
      weights += weight;
    }
    const edge = fade ? Math.min(1, i / fade, (frames - 1 - i) / fade) : 1;
    output[i] = Math.max(-1, Math.min(1, weights ? value / weights : 0)) * edge;
  }
  return {channels: [output], sampleRate: targetRate};
}
