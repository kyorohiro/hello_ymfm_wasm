/**
 * Sonic Pi「Pentatonic Bleeps」を参考にしたYM2612向けのアレンジ。
 * 出典: https://sonic-pi.net/examples.html
 *
 * 元のサンプル（Ruby）より引用:
 * with_fx :reverb, mix: 0.2 do
 *   live_loop :bleeps do
 *     play scale(:Eb2, :major_pentatonic, num_octaves: 3).choose, release: 0.1, amp: rand
 *     sleep 0.1
 *   end
 * end
 *
 * この例ではFM音色とOperatorのTLを使い、発音時間・待ち時間も変更しています。
 */
fm.setPreset(CH2, FM_PRESETS["ritual-bell"]);

const reverb = fx.reverb({
  mix: 0.2,
});

fx.setChain([reverb]);

liveLoop("bleeps", async () => {
  const notes = scale("Eb2", "majorPentatonic", 3);
  fm.setOperator(CH2, OP1, { tl: randInt(14, 40) });
  fm.setOperator(CH2, OP2, { tl: randInt(22, 45) });
  fm.setOperator(CH2, OP3, { tl: randInt(28, 50) });
  fm.setOperator(CH2, OP4, { tl: randInt(8, 30) });

  await play(choose(notes), {
    channel: CH2,
    duration: 0.1,
  });

  await sleep(0.001);
});
