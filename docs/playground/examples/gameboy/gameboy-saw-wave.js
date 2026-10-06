// Game Boyの波形メモリー：32点、各0〜15。三角波とノコギリ波を比較します。
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  const triangle = Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i);
  const sawtooth = Array.from({length: 32}, (_, i) => Math.floor(i / 2));
  for (const waveform of [triangle, sawtooth]) {
    // 転送時にwaveは停止します。再生開始はkeyOn()で明示します。
    gb.wave.setWaveform(waveform);
    gb.wave.setLevel(0.5);
    for (const note of ['C3', 'E3', 'G3', 'C4']) {
      gb.wave.setNote(note);
      gb.wave.keyOn();
      await sleep(0.25);
      gb.wave.keyOff();
      await sleep(0.05);
    }
  }
} finally {
  gb.dispose();
}
