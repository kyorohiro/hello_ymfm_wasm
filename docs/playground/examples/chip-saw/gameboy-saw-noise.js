// Game Boyノイズ：15-bitと7-bitの違い、分周とシフトを試します。
// noiseには音名指定がありません。設定は次のkeyOn()から反映されます。
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  for (const width of /** @type {const} */ ([15, 7])) {
    for (const shift of [2, 3, 4, 5]) {
      gb.noise.setVoice({
        volume: 10,
        envelope: {direction: 'down', period: 1},
        divisor: 3, shift, width,
      });
      gb.noise.keyOn();
      await sleep(0.2);
      gb.noise.keyOff();
      await sleep(0.1);
    }
  }
} finally {
  gb.dispose();
}
