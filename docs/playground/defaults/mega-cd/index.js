// Mega CD: YM2612 FM + Sega PSG + RF5C164 PCM + stereo CD-DA.
// Every sample is generated here; no game disc, BIOS or external ROM is needed.
// Mixer keeps your settings. Open CD-DA to inspect the backing track.
// Try examples/mega-cd/megacd-sampler.js for your own recorded keyboard instrument.
const pcm = await useSoundChip('rf5c164');
const sampleRate = 16000, rootNote = 48; // MIDI C3.
const samples = new Float32Array(Math.round(sampleRate * 0.32));
const soundingFrames = samples.length - 64;
for (let i = 0; i < soundingFrames; i++) {
  const ramp = Math.min(1, i / 80, (soundingFrames - 1 - i) / 480);
  const envelope = (1 - Math.cos(Math.PI * ramp)) / 2;
  samples[i] = 0.65 * Math.sin(2 * Math.PI * 440 * 2 ** ((rootNote - 69) / 12) * i / sampleRate) * envelope;
}
// Fade into 64 silent samples, then loop only that silence. The 32 consecutive
// 0xff end markers also catch pitch steps that skip RAM bytes.
const wave = await pcm.loadSample({channels: [samples], sampleRate}, {
  loopStart: soundingFrames, endGuardBytes: 32,
});
await pcm.setChannel(0, {...wave, volume: 100, pan: {left: 15, right: 15}});
const stepFor = midi => Math.round(wave.step * 2 ** ((midi - rootNote) / 12));

// A four-second original stereo accompaniment, encoded as 44.1 kHz PCM16 WAV.
// To use your own Virtual File instead: await cdda.load('/audio/track02.wav');
const rate = 44100, seconds = 4, frames = rate * seconds;
const wav = new Uint8Array(44 + frames * 4), view = new DataView(wav.buffer);
const tag = (offset, text) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
tag(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); tag(8, 'WAVE');
tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
view.setUint16(32, 4, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, frames * 4, true);
const roots = [48, 48, 52, 52, 53, 53, 55, 55];
for (let i = 0; i < frames; i++) {
  const beatFrame = i % (rate / 2), t = beatFrame / rate;
  const ramp = Math.min(1, beatFrame / 1323, (rate / 2 - 1 - beatFrame) / 1323);
  const envelope = (1 - Math.cos(Math.PI * ramp)) / 2;
  const hz = 440 * 2 ** ((roots[Math.floor(i / (rate / 2))] - 69) / 12);
  const left = Math.sin(2 * Math.PI * hz * 2 * t) + Math.sin(2 * Math.PI * hz * 3 * t);
  const right = Math.sin(2 * Math.PI * hz * 2.5 * t) + Math.sin(2 * Math.PI * hz * 4 * t);
  view.setInt16(44 + i * 4, Math.round(left * 1600 * envelope), true);
  view.setInt16(46 + i * 4, Math.round(right * 1600 * envelope), true);
}
await cdda.load(wav);
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);

liveLoop('mega-cd-four-sources', async () => {
  await cdda.play(); // Restart at the beginning once per eight-beat phrase.
  const lead = ['C4', 'E4', 'G4', 'E4', 'F4', 'A4', 'G4', 'D4'];
  for (let i = 0; i < lead.length; i++) {
    const note = lead[i];
    await pcm.setPitch(0, stepFor(roots[i]));
    await pcm.keyOn(0);
    psg.tone(PSG1, {note, attenuation: 14});
    await play(note, {channel: CH1, beats: 0.8});
    // The PCM has already faded out before this 400 ms gate closes.
    psg.off(PSG1);
    await pcm.keyOff(0);
    await beat(0.2);
  }
});
// CD-DA: await cdda.pause(); await cdda.resume(); await cdda.seek(2);
// Each phrase restarts the track. Stop cancels the loop and stops all four sources.
// Web Audio / Native and Main / Worker use the same cdda and beat APIs.
