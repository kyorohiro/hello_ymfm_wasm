/**
 * Sonic PiのDarin Wilsonによる3つの長いループを参考にしたFMアレンジ。
 * Original: Coded by Darin Wilson
 * 出典: https://sonic-pi.net/examples.html
 * 元のサンプル（Ruby）より引用:
 * use_synth :hollow
 * with_fx :reverb, mix: 0.7 do
 *   live_loop :note1 do
 *     play choose([:D4,:E4]), attack: 6, release: 6
 *     sleep 8
 *   end
 *   live_loop :note2 do
 *     play choose([:Fs4,:G4]), attack: 4, release: 5
 *     sleep 10
 *   end
 *   live_loop :note3 do
 *     play choose([:A4,:Cs5]), attack: 5, release: 5
 *     sleep 11
 *   end
 * end
 *
 * :hollowそのものの再現ではなく、弱い2OP変調の音色に置き換えています。
 * 60 BPMで、元の音程・発音間隔・attack/releaseの拍数を使います。
 * TLを動かして音量を作るため、エンベロープの形は原作とは異なります。
 * 立ち上がりはゆっくりです。Runしてから少し待って聴いてください。
 */
setBpm(60);

const reverb = await livePrepare("slow-hollow-reverb", ({ fx }) =>
  fx.reverb({ mix: 0.7, room: 0.8, tone: 4000 })
);
fx.setChain([reverb]);

const parts = [
  { name: "note1", channels: [CH1, CH2], notes: ["D4", "E4"], attack: 6, release: 6, interval: 8 },
  { name: "note2", channels: [CH3, CH4], notes: ["F#4", "G4"], attack: 4, release: 5, interval: 10 },
  { name: "note3", channels: [CH5, CH6], notes: ["A4", "C#5"], attack: 5, release: 5, interval: 11 },
];

// OP1 → OP2の弱い変調。OP2だけが聞こえるキャリアです。
for (const part of parts) {
  for (const channel of part.channels) {
    fm.setPreset(channel, FM_PRESETS["two-op-organ"]);
    fm.setOperator(channel, OP1, { multi: 2, tl: 48, ar: 31, d1r: 0, d2r: 0, sl: 0 });
    fm.setOperator(channel, OP2, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
  }
}

async function envelope(channel, beats, rising) {
  const steps = Math.ceil(beats * 40);
  let previousTL = -1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const amplitude = rising ? (1 - Math.cos(Math.PI * t)) / 2 : (1 + Math.cos(Math.PI * t)) / 2;
    // YM2612のTLは大きいほど小音量。頂点をTL10に抑えます。
    const tl = amplitude <= 0 ? 127 : Math.min(127, Math.round(10 - 20 * Math.log10(amplitude) / 0.75));
    if (tl !== previousTL) fm.setOperator(channel, OP2, { tl });
    previousTL = tl;
    if (i < steps) await beat(beats / steps);
  }
}

// 2CHを交互に使い、前の音の余韻を切らずに次の音を始めます。
// 各CHはintervalの2倍で繰り返し、後半のCHをinterval拍だけずらします。
for (const part of parts) {
  part.channels.forEach((channel, voice) => {
    let first = true;
    liveLoop(`${part.name}-${voice + 1}`, async () => {
      if (first) {
        first = false;
        if (voice === 1) await beat(part.interval);
      }
      fm.setOperator(channel, OP2, { tl: 127 });
      const pitch = noteToBlockFnum(choose(part.notes));
      fm.setFrequency(channel, pitch.block, pitch.fnum);
      fm.keyOn(channel);
      await envelope(channel, part.attack, true);
      await envelope(channel, part.release, false);
      fm.keyOff(channel);
      await beat(part.interval * 2 - part.attack - part.release);
    });
  });
}
