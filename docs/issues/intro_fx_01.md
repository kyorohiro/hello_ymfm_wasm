# FX 入門記事の構想

## 目的と掲載場所

対応しているFXについて、音を聴き、波形を見て、コードを変更しながら学べる記事を
`docs/introductions/` に追加する。Gain・Slicerの記事を試作済み。実ブラウザーでの表示・試聴確認は未実施。

既存の以下のページを構成・見た目・Playgroundへの導線の参考にする。

- [記事一覧](../introductions/index.html)
- [純正律と平均律の解説](../introductions/tetorica-just-intonation-equal-temperament-ym2612.html)

組み込みの `fx` で効果を体験し、`liveFx` で小さな処理を書いて仕組みを理解する。
学習用コードで組み込みFXを完全再現することは目標にしない。
実験として面白いだけでなく、「何を学ぶか」「どこを変えると何が変わるか」が
明確なサンプルを載せる。

## 記事の順序案

「現在のサンプルを加工 → 履歴を使う → 過去の音をバッファにためる」の順に進める。
組み込みFXの対応は `web/native_fx.js` の13種類を基準とする。
Envelope Followerは基礎説明、最後の章は組み合わせの説明として加える。

| 順序 | テーマ | 主な学習内容・実験 | 観測の中心 |
| --- | --- | --- | --- |
| 1 | Gain | サンプルに掛け算する。振幅と音量、線形倍率とdB | 加工前後の波形 |
| 2 | Slicer | Gainを周期的に切り替える。周期・開いている割合・音を刻む効果 | 波形と試聴 |
| 3 | Distortion | `tanh`等で波形を変形し、倍音を増やす。入力増幅と出力音量を分ける | 波形とSpectrum |
| 4 | Bitcrusher | 振幅の段階数を減らす、同じサンプル値を保持する。2つの加工の違い | 波形とSpectrum |
| 5 | Filter | 前回値を使った簡単なローパスから、高域・低域の扱いへ進む | Spectrum |
| 6 | EQ | 周波数帯ごとの強さを調整。Bass / Mid / Treble | Spectrumと試聴 |
| 7 | Wobble | フィルターの周波数を周期的に動かす。周期と変化幅 | Spectrumの変化と試聴 |
| 8 | Envelope Follower（基礎編） | 入力の強さを追う。整流と平滑化、Attack / Release | Envelopeの推移（表示拡張候補） |
| 9 | Noise Gate | 小さな音を抑える。Threshold・Hysteresis・開閉にかかる時間 | 波形と試聴 |
| 10 | Compressor | 大きな音を抑える。Threshold / Ratio / Attack / Release / Makeup | 波形、ゲイン削減量（表示拡張候補） |
| 11 | Delay | リングバッファ、読み書き位置、遅延時間、Feedback、Dry / Wet | 短い音の反復を聴く |
| 12 | Flanger | 短い遅延を動かして原音と混ぜる。干渉による音色変化 | Spectrumと試聴 |
| 13 | Chorus | 動く遅延による揺れや厚み。Flangerとの比較 | 試聴 |
| 14 | Reverb | 複数の遅延・フィードバックで残響を作る。アルゴリズム型を扱う | 発音停止後の減衰と試聴 |
| 15 | 組み合わせ | `setChain` / `branch` / `parallel`、処理順と音量管理 | 加工順の聴き比べ |

Envelope Followerは独立した組み込みFXとして紹介しない。
GateとCompressorに必要な考え方を、`liveFx`で説明する橋渡しの章とする。
ADSRは発音・離鍵との関係が必要になるため、最初のシリーズの必須項目にはしない。

最終章の例は「Distortion → EQ」と「EQ → Distortion」。
同じFXを使っても、順序によって音が変わることを示す。

## 各記事の共通構成

1. 加工前後を聴き、何が変わるFXなのかをつかむ。
2. 組み込みの `fx` を使う短い例を示す。
3. 波形・Spectrumと音を結び付ける。
4. `liveFx`で最小の仕組みを書く。入力・加工・出力を明示する。
5. 1つずつパラメーターを変える実験を用意する。
6. 組み込みFXとの違いと、実際の利用方法を説明する。
7. Playgroundへ持ち込み、Run / Apply / Stopで試せるようにする。

Reverbなどでは、完成品の実装全体を最初から読ませず、小さな構成から説明する。
サンプルは各記事単独で動作し、外部音声ファイルなしでも試せる構成を優先する。
音色の変化を比べる際は、単に出力音量が増えた効果と区別できるようにする。

## liveFxで最初に説明すること

- `process(input, output, state, context)` は音声ブロックごとに実行される。
- input/outputのCHはステレオの左右。YM2612の物理CHではない。
- 現在のliveFxは音源を混ぜた後、native FXの後段に掛かる。
- `context` は外から渡す設定のコピー。`fx.updateContext(name, patch)` で部分更新する。
- `state` はAudioWorklet側の履歴。`state.prev ??= []` のように初回だけ初期化できる。
- 同名の再登録ではstateを保持する。`resetState: true` またはStopで初期化できる。
- 外側の変数は捕捉できない。必要な値はcontextで渡す。
- `i` はブロックごとに0に戻る。周期やバッファ位置はstateで継続させる。
- 音声処理は同期的に完了させ、毎サンプルの配列確保や無制限のループを避ける。
- 学習用の係数や時間の単位を明記する。サンプル数指定は再生レートによって時間が変わる。

## 表示の方針と現状

FX Monitorで選択したliveFxの入力と出力を比較する。

- 波形：振幅の変化、潰れ、途切れを確認する。
- Spectrum：倍音や周波数帯ごとの増減を見る。
- 入力と出力は共通の固定スケールで表示する。個別の自動正規化でGain差を消さない。
- 音声の履歴や減衰を知るには試聴も必要。短い窓のFFTだけで判断しない。

現在は2048サンプルのHann窓FFT・線形周波数軸。
低音の倍音が左端に密集して変化が見えにくい場合がある。
Distortionの導入では、倍音が増える様子を確認しやすいサイン波を用意する。
組み込みnative FX単体の前後や、stateの内部値を直接選んで見る機能は現状ない。
記事で使う表示が未対応の場合、対応済みであるかのように説明しない。

後から必要に応じて検討する表示：

- 対数周波数軸、低域へのズーム、入力との差分。
- Envelopeとゲイン削減量の時間推移。
- スペクトログラム。

これらを全記事の着手条件にはしない。
観測は表示中だけ行い、表示やFFTが遅くても音声処理を待たせない方針を維持する。

## 執筆・確認タスク

- [x] Gainの記事を作り、シリーズ共通の構成を決める（試作）。
- [x] 上記の順序で各章の下書きを追加する（全15章）。
- [ ] 各コードを現在のAPI・型定義・パラメーター範囲と照合する。
- [ ] PlaygroundのWorker on/off、Run / Apply / Stopで確認する。
- [ ] 長時間再生とブロック境界で状態が途切れないか確認する。
- [ ] 波形・Spectrumの変化と試聴結果が説明に合っているか確認する。
- [ ] 初見で操作できる説明と、各記事からPlaygroundへの導線を用意する。
- [ ] `docs/introductions/index.html` に記事へのリンクを追加する。
- [ ] 必要な表示拡張は記事の実験に合わせて個別に判断する。

## 実装の参照先

- `web/native_fx.js`：組み込みFXの種類、パラメーター、操作API。
- `native/audio_effect/`：組み込みDSP。
- `web/custom_fx.js`：liveFxの実行とstate/contextの管理。
- `docs/playground/examples/livefx/live-fx-distortion.js`：現行の自作FXサンプル。
- `docs/issues/custom_fx_01.md`：liveFxとFX Monitorの設計・制約。

## 試作した記事

[FX入門の目次](../introductions/tetorica-fx.html)を作成し、docs/index.htmlから「作成中」として案内する。

- [Gain](../introductions/tetorica-fx-gain.html)
- [Slicer](../introductions/tetorica-fx-slicer.html)

各記事に組み込みFXとliveFxのPlayground iframeを配置。既存のplayground-embed.jsで
読みやすいコードからURLを生成し、フル表示でCodeとFX Monitorを利用できるようにした。
記事一覧からリンク済み。

自動確認：`node --test docs/introductions/fx-introduction.test.mjs`。
4本の埋め込みコードのAPI・演奏ループ、Gainの倍率、Slicerの周期・左右同期を確認。
ブラウザー表示・試聴、Worker on/off・Apply操作の確認は残る。


## 残りの章の下書き

Distortion / Bitcrusher / Filter / EQ / Wobble / Envelope Follower / Noise Gate /
Compressor / Delay / Flanger / Chorus / Reverb / 組み合わせの13記事を追加した。
目次は `docs/introductions/tetorica-fx.html`。各記事から前後の章へ移動できる。

組み込みFXと学習用liveFxを分け、簡易実装の限界を明記した。
Envelope FollowerはliveFxのみ、組み合わせは直列・並列の2例。
組み込みFXの後は素通しのliveFx("none")で観測するため、Monitorは
組み込みFXの前後比較ではない。遅延バッファを使う例はApply時にstateを再初期化する。
時間・周波数を扱う自作例は、context.sampleRateをMonitorの実レートに合わせる。

自動確認：
`node --test docs/introductions/fx-introduction.test.mjs docs/introductions/fx-remaining-lessons.test.mjs`

追加25本の埋め込みコードについて、API呼び出し、プリセット、演奏ループ、
Apply時のノード再利用、記事間リンクを確認。liveFxを実行して有限・非無音出力、
128/256サンプルのブロック分割での結果一致、Delayのインパルス応答を確認する。
組み込みDSPの音質、ブラウザー表示・試聴、Worker on/off・実際のApply操作は未確認。
記事の説明・初期パラメーターは手動確認しながら調整する。
