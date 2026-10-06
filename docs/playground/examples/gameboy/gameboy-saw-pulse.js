// Game Boy pulse: 高水準APIでデューティ比と左右出力を比較。
// 2つの矩形波CHを左右に振り分け、4種類のデューティ比を比較します。
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.setPan(0, true, false);
  gb.setPan(1, false, true);
  for (const duty of /** @type {const} */ ([0.125, 0.25, 0.5, 0.75])) {
    for (const ch of /** @type {const} */ ([0, 1])) {
      gb.pulse.setVoice(ch, {
        duty, volume: 10, envelope: {direction: 'down', period: 2},
      });
    }
    for (const note of ['C4', 'E4', 'G4', 'C5']) {
      gb.pulse.setNote(0, note);
      gb.pulse.setNote(1, 'C4');
      gb.pulse.keyOn(0);
      gb.pulse.keyOn(1);
      await sleep(0.2);
      gb.pulse.keyOff(0);
      gb.pulse.keyOff(1);
      await sleep(0.05);
    }
  }
} finally {
  gb.dispose();
}
