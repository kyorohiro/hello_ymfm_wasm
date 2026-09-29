// chip-saw: chip-rawの次に並ぶ高水準APIの例。sawは波形名ではありません。
// 2つの矩形波CHを左右に振り分け、4種類のデューティ比を比較します。
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.setPan(0, true, false);
  gb.setPan(1, false, true);
  for (const duty of [0.125, 0.25, 0.5, 0.75]) {
    for (const ch of [0, 1]) {
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
