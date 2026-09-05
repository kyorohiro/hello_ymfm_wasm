Tetorica FM2612 Playground は、現状「音を作る」「演奏する」ための機能はかなり揃っている。

今後、Playground を使って FM 音源の分析・研究・音作りを進めるなら、次に必要なのはシンセ機能の追加よりも「鳴らした結果をコードから観測できる仕組み」。

目標は、Playground 自体を FM 音源の実験環境として使えるようにすること。

理想的には、

VGM / Preset
→ 再生
→ 波形取得
→ 分析
→ 仮説
→ FM パラメータ変更
→ 再レンダリング
→ 比較

というループを Playground 内だけで完結できるようにする。

最優先: Audio Render / Capture

まず必要なのは、生成した音を Float32Array として取得できる API。

例:

const audio = await render(async () => {
  fm.setPreset(CH1, preset);
  await play("C4", {
    channel: CH1,
    duration: 1,
  });
});

または、

const audio = await capture({
  source: "master",
  seconds: 1,
});

返り値のイメージ:

type AudioCapture = {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
};

Float32Array を取得できれば、分析アルゴリズム自体は JavaScript 側で自由に実装できる。

そのため、最初から巨大な Analyzer API を作る必要はない。

基本的な音響分析

最低限あると便利なのは以下。

analyze.rms(audio);
analyze.peak(audio);
analyze.fft(audio);
analyze.peaks(spectrum);

RMS

音量の比較。

例えば TL や Algorithm を変更した場合の実効音量を比較できる。

Peak

最大振幅。

クリッピングや Feedback を強くした場合などの確認に使える。

FFT

FM 音源研究では特に重要。

MULTI、Algorithm、Feedback、TL などを変更した時に、倍音構成がどう変化するかを調べられる。

例:

const spectrum = analyze.fft(audio, {
  size: 4096,
});
const peaks = analyze.peaks(spectrum);
log(peaks);

結果イメージ:

440 Hz    -3.1 dB
880 Hz    -9.8 dB
1320 Hz  -15.2 dB
1760 Hz  -21.0 dB

これにより、

* MULTI を変えると何倍音が出るか
* Algorithm の違い
* Feedback による高域の増加
* Operator の組み合わせによるスペクトル変化

などを数値として調べられる。

Frequency / Note 相互変換

現在の Note → YM2612 に加えて、逆方向も欲しい。

frequencyToNote(440);

結果例:

{
  note: "A4",
  midi: 69,
  cents: 0
}

さらに、

blockFnumToFrequency(block, fnum);
blockFnumToNote(block, fnum);

があると VGM Analyzer 側でも利用できる。

あると便利な補助関数:

noteToMidi("C4");
midiToNote(60);
frequency("A4");
transpose("C4", 7);
interval("C4", "G4");

Register / Event Trace

音そのものだけでなく、「YM2612 に何を送ったのか」も記録できると分析しやすい。

例:

const trace = beginTrace();
fm.setOperator(...);
fm.noteOn(...);
await sleep(0.5);
fm.noteOff(...);
const events = trace.end();

結果:

[
  {
    time: 0.000,
    type: "write",
    register: 0x30,
    value: 0x71
  },
  {
    time: 0.000,
    type: "noteOn",
    channel: 0
  },
  {
    time: 0.500,
    type: "noteOff",
    channel: 0
  }
]

これがあると、

VGM Analyzer
と
Playground

を同じイベント表現で繋ぎやすくなる。

Parameter Sweep

FM 音源はパラメータが多いため、値を少しずつ変えて比較する仕組みが重要。

専用 API を作らなくても、最低限、

range(0, 7);

のような補助関数があればよい。

例:

for (const feedback of range(0, 7)) {
  fm.setAlgo(CH1, 0, feedback);
  const audio = await render(async () => {
    await play("C4", {
      channel: CH1,
      duration: 1
    });
  });
  log(
    feedback,
    analyze.rms(audio)
  );
}

同様に、

* MULTI 1〜15
* TL 0〜127
* Feedback 0〜7
* Algorithm 0〜7
* Attack / Decay / Release

などを自動比較できる。

AI に実験させる場合にも非常に重要。

例えば、

「OP1 MULTI を1〜15まで変更し、それぞれ C4 を鳴らして FFT し、第1〜第10倍音を比較する」

という指示をそのまま実行できるようになる。

Plot / Visualization

分析結果を Playground 上に簡単に描画できる機能も欲しい。

Canvas API を直接開放するより、シンプルな Plot API の方が使いやすい。

例:

plot([
  [0, 1.0],
  [1, 0.7],
  [2, 0.4],
  [3, 0.2],
]);

または補助 API として、

plot.waveform(audio);
plot.spectrum(spectrum);

があってもよい。

汎用 plot が1つあれば、

* Waveform
* Spectrum
* Envelope
* TL vs RMS
* MULTI vs Harmonic
* Feedback vs Brightness
* Algorithm 比較

などを全部表示できる。

音楽理論 API

これは優先度は低め。

現在の scale / chord を拡張する場合は、

chord("C4", "dim");
chord("C4", "aug");
chord("C4", "sus2");
chord("C4", "sus4");

などがあると便利。

ただし、FM 音源分析という目的なら後回しでよい。

最初に追加する候補

まずは以下だけで十分。

render(...)
capture(...)
analyze.rms(...)
analyze.peak(...)
analyze.fft(...)
analyze.peaks(...)
frequencyToNote(...)
blockFnumToFrequency(...)
plot(...)

特に重要なのは、

render() / capture()
↓
Float32Array を取得できる

という部分。

ここが実装されると、Playground は単なる Live Coding 環境ではなく、FM 音源の実験・解析環境になる。

今後の方向性としては、

「API をたくさん追加する」

より、

「Playground から自分が生成した音を観測できる」

ことを優先する。

最終的には、

VGM
→ Register/Event
→ Audio
→ Spectrum
→ Parameter Analysis
→ FM Patch
→ Audio

という一連の流れを Tetorica FM2612 Playground 内で扱えるようにする。
