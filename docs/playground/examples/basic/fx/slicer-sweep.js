/**
 * Sonic Pi「Tron Bikes」を参考にしたYM2612向けのアレンジ。
 * Original: Coded by Sam Aaron
 * 出典: https://sonic-pi.net/examples.html
 *
 * 元のサンプル（Ruby）より引用:
 * # Tron Bikes
 * # Coded by Sam Aaron
 *
 * use_random_seed 10
 * notes =  (ring :b1, :b2, :e1, :e2, :b3, :e3)
 *
 * live_loop :tron do
 *   with_synth :dsaw do
 *     with_fx(:slicer, phase: [0.25,0.125].choose) do
 *       with_fx(:reverb, room: 0.5, mix: 0.3) do
 *
 *         n1 = (chord notes.choose, :minor).choose
 *         n2 = (chord notes.choose, :minor).choose
 *
 *         p = play n1, amp: 2, release: 8, note_slide: 4, cutoff: 30, cutoff_slide: 4, detune: rrand(0, 0.2)
 *         control p, note: n2, cutoff: rrand(80, 120)
 *       end
 *     end
 *   end
 *
 *   sleep 8
 * end
 *
 * この例ではdsawをFM Stringsに置き換え、音程をtweenで動かします。
 * cutoffの変化の代わりにOP4のTLを変え、最後にGain 3倍を加えています。
 * ランダムseedは固定せず、発音時間・待ち時間も変更しています。
 */
setBpm(96);

fm.setPreset(CH2, FM_PRESETS["fm-strings"]);

const mainFx = await livePrepare("slicer-sweep-chain", async ({ fx }) => {
  const slicer = fx.slicer({
    phase: 0.25,
    mix: 1,
  });
  const reverb = fx.reverb({
    mix: 0.3,
    tone: 5200,
  });

  const volume = fx.gain({
    gain: 3.0,
  });

  return {
    slicer,
    reverb,
    volume,
  };
});

fx.setChain([
  mainFx.slicer,
  mainFx.reverb,
  mainFx.volume,
]);

liveLoop("bikes", async () => {
  const roots = ["B1", "B2", "E1", "E2", "B3", "E3"];
  mainFx.slicer.phase.set(choose([0.25, 0.125]));

  const startNote = choose(chord(choose(roots), "minor"));
  const finalNote = choose(chord(choose(roots), "minor"));
  const start = noteToBlockFnum(startNote);

  fm.setFrequency(CH2, start.block, start.fnum);
  fm.keyOn(CH2);

  await tween(1.5, (t) => {
    const pitch = noteLerp(startNote, finalNote, t);
    fm.setFrequency(CH2, pitch.block, pitch.fnum);
    fm.setOperator(CH2, OP4, {
      tl: Math.round(lerp(36, 12, t)),
    });
  });

  fm.keyOff(CH2);
  await beat(2);
});
