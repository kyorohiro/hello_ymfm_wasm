VGM Player に Mega Drive 32X の PWM 再生を追加してください。

今回は32Xハードウェア互換エミュレーションは不要です。
VGM内のPWMコマンドを解析して、音として再生できればOKです。

目的は、

VGM PWM command
  ↓
PWM value
  ↓
PCM sample に簡易変換
  ↓
既存 AudioWorklet で再生

です。

Pulse Width 値は、Cycle値を使って単純に -1.0〜+1.0 のPCM値へ変換してください。

function pwmToSample(value, cycle) {
  if (cycle <= 1) return 0;
  return (value / cycle) * 2 - 1;
}

Left / Right がある場合は stereo として処理してください。

今回は以下は不要です。

* SH-2 emulation
* DMA
* interrupt
* 正確なFIFO再現
* 実際のPWM矩形波生成
* analog LPF
* 完全なcycle timing再現
* 32X本体のhardware emulation

VGM Player の既存構造を優先し、現在のVGM parser / command queue / AudioWorklet の流れを大きく変更しないでください。

YM2612 DACなど、既存のPCM sample再生経路が再利用できるなら利用してください。
ただし大規模なリファクタリングは不要です。

まず対象VGMコマンドを確認し、

1. PWM Cycle設定を読む
2. PWM Left / Right / Mono の値を読む
3. PCM sampleへ変換
4. VGMのwait timingに従って再生

まで実装してください。

今回の完成条件は、

32X PWMを含むVGM/VGZをVGM Playerで開いたとき、PWM部分の音がそれらしく鳴ること

です。

正確な32X互換性は後回しにしてください。

## v0.0.0 実装状況（2026-09-11）

- VGMヘッダーのPWM clockと、直接書き込み `0xB2` を解析。
- GenesisAudioEngine内に独自実装の `SimplePwm` を追加。左右の値を次の書き込みまで保持し、既存の音声キュー・AudioWorkletへ混合する。
- Cycle変更、Left / Right / Mono、マスター音量、AnalyzerのPWMミュートに対応。
- ストリーム `0x90`〜`0x95` はPWM専用の16-bitデータ読み出しに対応。Step Base / Step Size、バンク内ブロック指定、ループ・逆順・停止を扱う。
- データブロック `0x03` と、`0x43` のn-bit copy/shift圧縮に対応。圧縮はVGM仕様から独自実装した。GPLコードのコピー・リンクは行っていない。
- テーブル圧縮・DPCM圧縮は未対応で、明示的にエラーにする。

### 簡易再生の扱い

- PCM変換は本文の式を使用し、-1〜+1に制限する。
- 未書き込み・値0・Cycleが0または1の場合は無音とする。実機の特殊値処理とは区別する。
- 左右入れ替え指定は反映するが、出力先ビットが0の場合は直接の左右出力として扱う。CelticのログはControl=0x300で、ハードウェアの出力OFFをそのまま適用すると無音になるため。
- PWMクロックからFIFOの消費時刻は生成しない。VGMのwaitとストリーム周波数を再生時刻の基準にする。
- 波形表示は今回の対象外。PWM出力のキャプチャは下記の追加対応を参照。

### 検証

- `node --test web/pwm.test.mjs docs/vgm_analyzer/*.test.mjs`
- 手元の `01 - The Imperial March.vgz` をVgmPlayerとGenesisAudioEngineのPWM経路で最後までレンダリング。FM/PSGはテスト用無音出力に置換。
- 約34.011秒、出力53,267HzでRMS約0.0377、peak約0.2053。有限・非ゼロのPCM出力を確認。
- ブラウザー上の試聴、参照プレイヤーとの波形一致、実機との一致は未検証。

仕様参照: https://vgmrips.net/wiki/VGM_Specification

### Sample Explorer: PWM出力キャプチャ

- 直接書き込みとストリーム書き込みを共通の再生ターゲットで取得する。
- 最初のLeft/Right/Mono書き込みから曲末まで、最大10秒単位で表示する。元の楽器やサンプル境界は推定しない。
- 各区間の初期状態（Cycle、Control、左右の保持値）と、44,100Hz基準の相対時刻・レジスタ・12-bit値を時刻付きJSONとして保存する。
- 通常再生と同じSimplePwm変換でステレオプレビューと44,100Hz/16-bitステレオWAV保存ができる。WAVは簡易変換済み出力で、JSONには変換前の値を残す。
- 区間をまたぐ保持音やCycle変更も再現。400万書き込み・4096区間の上限を設ける。

### 密な直接書き込みでの再生キュー修正

`Virtua Fighter / 05 Win.vgz` はPWM直接書き込みが23,315回あり、短いwaitを挟む。
従来のVgmPlayerは1回512イベントで処理を中断するため、最初の4096出力フレームのうち
645フレームしか生成できず、残り3451フレームを無音で埋めていた。
このためPWMをミュートしても、他の音源を含む再生全体が途切れる。

通常のイベント上限を先読みの制限に変更し、呼び出し側が要求した音声フレームまでは
生成を続ける。時間が進まない不正データに備えた別の上限は維持する。
密な書き込みでのPWM出力と、PWMミュート中のFM出力に無音が挿入されない回帰テストを追加。
PWM値の変換式はこの修正では変更していない。実際の聴感は再確認する。
