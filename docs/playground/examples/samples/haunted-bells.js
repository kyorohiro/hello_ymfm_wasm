/**
 * Sonic Pi「Haunted Bells」— Coded by Sam Aaron
 * 出典: https://sonic-pi.net/examples.html
 * 元のサンプル（Ruby）より引用:
 * live_loop :haunted do
 *   sample :perc_bell, rate: rrand(-1.5, 1.5)
 *   sleep rrand(0.1, 2)
 * end
 *
 * PlaygroundのPCMサンプル再生によるアレンジ（YM2612のFM合成ではありません）。
 * 極端に長い再生を避けるため、速度の絶対値は0.2以上にしています。
 */
setBpm(60);

await livePrepare("haunted-bells-sample", async ({ sample }) => {
  await sample.load("sonic-pi/perc-bell");
});

liveLoop("haunted", async () => {
  const direction = choose([-1, 1]);
  await sample.play("sonic-pi/perc-bell", {
    playbackRate: direction * rrange(0.2, 1.5),
  });
  await beat(rrange(0.1, 2));
});
