// PC Engine + CD-DA (first stage: PSG + stereo PCM16, without ADPCM).
// Original generated test audio: no game disc or BIOS is required.
// For your own 44.1 kHz stereo PCM16 WAV in Virtual Files, replace the
// generated WAV below with: await cdda.load('/audio/track02.wav');
const rate = 44100, seconds = 8, frames = rate * seconds;
const wav = new Uint8Array(44 + frames * 4), view = new DataView(wav.buffer);
const tag = (offset, text) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
tag(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); tag(8, 'WAVE');
tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true);
view.setUint16(32, 4, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, frames * 4, true);
for (let i = 0; i < frames; i++) {
  const t = i / rate, envelope = Math.min(1, t * 20, (seconds - t) * 20);
  view.setInt16(44 + i * 4, Math.round(Math.sin(2 * Math.PI * 220 * t) * 3500 * envelope), true);
  view.setInt16(46 + i * 4, Math.round(Math.sin(2 * Math.PI * 330 * t) * 3500 * envelope), true);
}
await cdda.load(wav);
await cdda.play();
// Transport: await cdda.pause(); await cdda.resume(); await cdda.seek(2);
// await cdda.getState() reports the audio-side source frame and position.
// Mixer has independent "cdda" and "huc6280" inputs.
pce.setWaveform(0, Array.from({length: 32}, (_, i) => Math.round(15.5 + 15.5 * Math.sin(i * Math.PI / 16))));
pce.setVolume(0, 22);
pce.setPan(0, 15, 15);
setBpm(120);
liveLoop('psg-over-cdda', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4']) {
    pce.noteOn(0, note);
    await beat(1);
  }
});
