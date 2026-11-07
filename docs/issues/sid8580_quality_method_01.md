# SID 8580: conditions for the isolated audio comparison

2026-11-07。これは独立probeと外部referenceを比較する測定方法であり、
本番Playerへの採用、実機一致、実聴による音質合格を宣言する文書ではない。
既存の6581製品、SDK、SID Player、過去の測定結果は変更しない。

## 比較の目的と一次資料

初期accumulator／envelope、sampling、出力RC、全体gainの違いを、
8580の波形／ADSR／filter／resonanceの違いから分ける。
GPL音源の内部実装を参照してpermissiveコアへ転用せず、
公開APIへの自作register列と、次の物理回路資料に基づいて観測する。

- [MOS6581 datasheetの原本再掲](https://www.waitingforfriday.com/?p=661):
  周波数register、TEST、read可能なOSC3／ENV3、filter mode／routingの仕様。
  6581資料なので、ここから8580固有のanalog定数まで推定しない。
- [8580 filter overview](https://github.com/libsidplayfp/SID_schematics/wiki/8580-Filter-overview):
  dieに基づく回路図はHP summer、BP／LPの2積分段、外付けcapacitor、routing／mode、下流のvolume段を示す。
  resonanceはBP feedback側と入力側の抵抗networkへ作用する。ピーク振幅だけをQの値とは扱わない。
- [8580 DACs](https://github.com/libsidplayfp/SID_schematics/wiki/8580-DACs):
  cutoffは2つのfrequency DACで制御される。11bitのFCが0のときにも別のbranchが働くため、
  FC=0を単純な完全遮断や無限抵抗とみなさない。
- [8580 AC voltage divider](https://github.com/libsidplayfp/SID_schematics/wiki/8580-AC-Voltage-divider)、
  [8580 opamps](https://github.com/libsidplayfp/SID_schematics/wiki/8580-Opamps):
  clockに結び付いたcapacitor回路と温度補償を持つ。別のclock／capacitor／個体に数値を無条件で一般化しない。
- [External filter](https://github.com/libsidplayfp/SID_schematics/wiki/External-Filter):
  motherboardのlow-passと、接続先impedanceに依存するAC couplingはSID内部filterとは別。
  参照とcandidateの出力段の差を、そのまま8580内部filterの誤差とは解釈しない。

## 発音と観測窓の条件

1. 全3voiceのAD／SRを0、Gate OFF、TEST ONにし、releaseと出力段のsettlingを進める。
   両engine自身のOSC3／ENV3を読み、位相0／envelope0を確認する。
   TESTだけでenvelopeや出力RCまで初期化されたとは仮定しない。
2. 観測しやすいvoice 3をcarrierにし、AD=0／SR=`$F0`、同じ整数frequency register、
   同じwaveformを設定する。TEST解除とGate ONの時刻を同じchip cycleへ固定する。
   他2voiceはTEST／Gate OFFを保つ。REFのread値をcandidateへ注入しない。
3. active voiceのENV3=255と、隣り合う観測窓での振幅・meanの安定を確認する。
   warmupのcycle数、実read値、capture開始／終了、窓長、安定判定の閾値を結果へ残す。
   規定cycleを待っただけで、すべての内部状態が同一になったとは宣言しない。
4. dryとfilteredは、同一core・同じ発音条件・同じcarrier／音量・同じ観測窓で別に測る。
   dryはrouting=0／mode=0、filteredはcarrierのrouting bitを立ててLP／BP／HPを選ぶ。
   voice 3のdirect muteとfiltered経路の違いを混同しない。
5. 音源差の診断ではPCMを無条件にpeak正規化しない。必要なmean除去やharmonic fitは、
   処理方法を明記した解析値として保存し、元のraw測定値も保持する。

ADSRそのものの比較は、steady-state filter測定と別の窓で行う。
Gate event、ENV3 step、release、TEST解除後のOSC3を同じchip cycleで観測し、
read pipelineとaudio pipelineの遅延も差として記録する。

## samplingの整合

新しい外部quality oracleは、公開APIでSID clockと同じ985,248 HzのDECIMATE出力を受け、
1 chip tickにつき1 sampleを生成できることを検証する。
その後、candidateとreferenceの両方へ同じhost側の整数位相decimatorを適用する。
古いoracleの固定1/1024-cycle periodや初回sampleの差を、後からPCM stretchで補正する方法は使わない。

位相0から始まるepochでは、0-based sample index `k`に対応するchip tickは
`ceil((k + 1) * 985248 / sampleRate)`。
skip中も同じ位相を進め、captureの実sample境界を記録する。
解析のsin／cos位相にはこの実tick時刻を使う。`k/sampleRate`だけでは整数tickへの丸めを隠す。
resetが位相を再開する場合は、そのepochの開始cycleも保持する。

common decimatorでsample数・観測gridを揃えても、各coreの公開出力APIに含まれる
1cycle等のpipeline差や、異なるRC/filterは残る。
自動的なphase合わせ、DC合わせ、gain fitでその差を消さない。

## 基本波と高調波を区別する

SIDの周波数は `f = frequencyRegister * clock / 2^24`。
PAL整数clock985,248 Hz、register上限65,535では、基本波上限は約3,848.5663 Hz。
したがって、6〜10 kHz付近のcutoffを**基本波のsweep**だけで測ったとは記録できない。

| 測定 | 入力／観測 | 結果の扱い |
| --- | --- | --- |
| 低いFC（例128／256）のBP resonance | 到達可能な基本波をsweepし、同一coreのdryとBPを比較 | 両側の−3 dB点が観測できる場合に限りapparent Qを推定 |
| 高いFC（例1024／1536）のLP／BP／HP | SAWの基本波を範囲内に置き、2〜4次等の選択harmonicを観測 | harmonic次数と実周波数を明記したtransfer診断。基本波やQ測定と混同しない |
| 波形／ADSR | dryのraw PCM、harmonic、OSC3／ENV3、時刻付きevent | filter補正に吸収せず、別の音源差として記録 |

実frequency registerから各harmonicのHzを計算する。
窓が整数周期でなくても、DCと既知周波数のsin／cosをleast-squares fitして振幅を求められる。
複数harmonicを同時fitすると、有限窓で他harmonicが混ざる影響を減らせる。
SAW全体のRMSでは、3次等が先にresonanceへ重なるため、基本波のresponseと誤認し得る。

同じcoreの選択harmonicについて、
`|H(f)| = amplitude(filtered, f) / amplitude(dry, f)`、
`gainDb = 20 * log10(|H(f)|)`を求める。
この比は、同じ周波数でのoscillator振幅・全体scale・共通の出力RCの影響を減らす。
ただし非線形回路ではharmonic間の混合や動作点の変化もあり、**内部filterだけを完全分離した伝達関数ではない**。
必要ならsustainによる実voice levelを変えて再測定する。出力PCMの後段gain変更をfilter入力levelの変更と扱わない。

## resonanceと有効性の判定

BPのresponseに十分なsweep範囲がある場合、各RES設定のpeakを基準にして
両側の−3 dB周波数`fLow`／`fHigh`を求め、
`apparentQ = fPeak / (fHigh - fLow)`とする。
これは二次band-pass近似での観測値で、resonance DACの内部係数や全条件での実機Qではない。
RES=0／4／8／12／15等を同じ条件で測り、peakの高さとbandwidthを分けて比較する。
観測範囲の端がpeakになったり、片側の−3 dB点が欠けたりする場合は、Qを捏造せず未確定とする。

- dry側の選択harmonicが小さい場合は比が不安定になる。amplitude、fit residual／noise、
  使用したSNR閾値を記録し、条件不成立は無効値とする。0 dBやinfinityで埋めない。
  SAWのfit residualには、まだfitしていない正当な高調波も含まれるため、その全量を雑音と呼ばない。
  量子化に対する最小振幅、隣接窓での再現性、既知harmonicを除いた局所noise等のguardを区別する。
- clipping、飽和、非finite値、観測窓の振幅変動、sample count／tick不一致を検査する。
  clipping判定・warmup・SNRの閾値は測定条件であり、SID hardwareの仕様値ではない。
- −3 dB crossingの補間方法と周波数gridも記録する。粗いgridから精密なQを断定しない。
- 高harmonicではNyquist、他harmonicのleakage、aliasing、出力LPの減衰も確認する。
  common decimationはanalog出力段の一致や完全なanti-aliasingを保証しない。
- cutoff／resonanceの差を見つけても、全体gainだけを合わせて解消済みとはしない。
  raw RMS比・短い窓のmean・相関だけから、聴感の優劣や実機への近さを結論しない。

結果にはsource／binary／fixture／解析のhash、model、clock、rate、全register条件、
skipとcapture範囲、read値、raw測定と正規化指標、無効条件、比較の限界を残す。
実機個体、実曲、長時間、AudioWorklet、既存Player統合はこの方法の完了条件とは別である。
