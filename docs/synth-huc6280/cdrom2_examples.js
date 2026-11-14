// SPDX-License-Identifier: BSD-3-Clause
// Original, generated sounds: no disc audio or game assets are embedded.
export const PC_ENGINE_CODE_EXAMPLES=Object.freeze({
  '/examples/huc6280.js': `const pce = await useSoundChip("huc6280");
setBpm(120);

// Use the sound edited above. This loop is software performance, not a chip sequencer.
liveLoop("pce-melody", async () => {
  const state = await pce.getState();
  const channel = state.editorSource === "noise" ? CH5 : CH1;
  const note = choose(scale("E3", "minorPentatonic", 2));
  if (state.editorLfoEnabled && state.editorLfoMode === "follow") {
    await pce.setNote(CH2, note); // CH2 supplies the hardware LFO to CH1.
  }
  await pce.noteOn(channel, note);
  await beat(0.25);
  await pce.noteOff(channel); // Uses the software envelope; keyOff is the raw gate.
  await beat(0.25);
});
`,
  '/examples/msm5205.js': `const adpcm = await useSoundChip("msm5205");
// Generate PCM in software, then encode it for the chip's 4-bit ADPCM RAM.
// This is a sample player, not a pitched noteOn instrument.
const samples = new Float32Array(8000);
for (let i = 0; i < samples.length; i++) {
  samples[i] = Math.sin(2 * Math.PI * 220 * i / 8000) * 0.25;
}
await adpcm.loadSample({sampleRate: 8000, channels: [samples]}, {rate: 12});
await adpcm.play({loop: true});
// Rate code 12 = 8 kHz. Raw offsets and lengths use nibbles, not bytes.
// Stop ends this Code session; Apply keeps the current session.
`,
  '/examples/cdda.js': `const cd = await useSoundChip("cdda");
setBpm(120);
// To play the track already loaded in the CD-DA tab, use await cd.play().
// The generated example below replaces that shared UI track.
// A Files path is also accepted: await cd.load("/audio/track.wav");
// Use a 44.1 kHz stereo PCM16 WAV, or a track manifest. CD-DA is separate
// from VGM; it has no oscillator or noteOn API.
const frames = 44100 * 2;
const wav = new Uint8Array(44 + frames * 4);
const view = new DataView(wav.buffer);
const tag = (offset, value) => [...value].forEach((c, i) => { wav[offset + i] = c.charCodeAt(0); });
tag(0, "RIFF"); view.setUint32(4, wav.length - 8, true); tag(8, "WAVE");
tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
view.setUint16(22, 2, true); view.setUint32(24, 44100, true);
view.setUint32(28, 44100 * 4, true); view.setUint16(32, 4, true);
view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, frames * 4, true);
for (let i = 0; i < frames; i++) {
  view.setInt16(44 + i * 4, Math.round(Math.sin(2 * Math.PI * 330 * i / 44100) * 6000), true);
  view.setInt16(46 + i * 4, Math.round(Math.sin(2 * Math.PI * 440 * i / 44100) * 6000), true);
}
await cd.load(wav);
// BPM changes the restart interval; the track still plays at 44.1 kHz.
liveLoop("cd-track", async () => {
  await cd.play();
  await beat(4);
});
`,
});

/** Add missing examples only. Existing user files and the input mode stay put. */
export function addPcEngineCodeExamples(project){
  const fold=path=>path.normalize('NFC').toLowerCase();
  const occupied=new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(fold));
  const entries=Object.entries(PC_ENGINE_CODE_EXAMPLES).filter(([path])=>!occupied.has(fold(path)))
    .map(([path,data])=>({path,type:'text',data}));
  if(entries.length)project.importFiles(entries);
  return entries.map(entry=>entry.path);
}
