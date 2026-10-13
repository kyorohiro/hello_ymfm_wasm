/**
 * Sam Aaron 作の Sonic Pi コードを参考にした Playground 向けのアレンジ。
 * Original: Coded by Sam Aaron
 *
 * 元のサンプル（Ruby）の合唱部分より引用:
 * # Coded by Sam Aaron
 *
 * with_fx :reverb do
 *   live_loop :choral do
 *     r = (ring 0.5, 1.0/3, 3.0/5).choose
 *     cue :choir, rate: r
 *     8.times do
 *       sample :ambi_choir, rate: r, pan: rrand(-1, 1)
 *       sleep 0.5
 *     end
 *   end
 * end
 *
 * この例では合唱部分をアレンジし、毎回再生速度を選び直します。
 * cue と wub_wub の伴奏部分は含めず、フェードとコンプレッサーを追加しています。
 */
setBpm(72);
setMasterVolume(1.0);

const choirFx = await livePrepare("ambient-choir-sample-fx", async ({ fx, sample }) => {
  await sample.load(
    "sonic-pi/ambi-choir"
  );

  const reverb = fx.reverb({
    mix: 0.24,
    tone: 6200,
  });

  return {
    reverb,
  };
});

const compressorSettings = {
  threshold: -26, // dB; reduce larger peaks in the overlapping voices.
  ratio: 4,
  attack: 0.002, // Seconds.
  release: 0.2, // Seconds.
  makeup: 0, // Keep output headroom instead of boosting the reduced signal.
};

const choirCompressor = await livePrepare("ambient-choir-sample-compressor", async ({ fx }) => {
  return fx.compressor(compressorSettings);
});

// Apply edits on every Run, including when livePrepare reuses the same effect.
choirCompressor.threshold.set(compressorSettings.threshold);
choirCompressor.ratio.set(compressorSettings.ratio);
choirCompressor.attack.set(compressorSettings.attack);
choirCompressor.release.set(compressorSettings.release);
choirCompressor.makeup.set(compressorSettings.makeup);

fx.setChain([
  choirFx.reverb,
  choirCompressor,
]);

liveLoop("choir", async () => {
  const rate = choose([0.5, 1 / 3, 3 / 5]);

  await sample.play("sonic-pi/ambi-choir", {
    playbackRate: rate,
    gain: 0.75,
    pan: rrange(-1, 1),
    fadeIn: 0.02,
    fadeOut: 0.28,
  });

  await sleep(0.5);
});
