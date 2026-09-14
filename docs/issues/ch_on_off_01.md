# チャンネル・音源 ON/OFF の現在の実装

## 位置づけ

目的は、VGM Analyzer の既存の CH On/Off、PSG・PCM などの切り替えを、
他のチップにも同じ操作感で追加すること。
この文書は現状のコード調査であり、全チップへの対応完了を意味しない。

既存機能は画面のボタンだけではなく、Analyzer のレジスタ処理、AudioEngine、
WASM、ymfm コアの変更で実現している。すべてが共通のミュート API を使っているわけではない。

## 現在の対応範囲

| チップ・構成 | CH 別の操作 | 音源単位の操作 | 実装と制約 |
| --- | --- | --- | --- |
| YM2612 / Mega Drive | FM CH1～6 | PSG 全体 | FM はパン出力を無効化。CH6 Off は DAC 書き込みも中立値へ置換。独立した DAC On/Off ボタンではない |
| Mega-CD 構成 | YM2612 と同じ | PSG、RF5C164 PCM 全体 | PCM の個別8CH切り替えではなく、合成時の PCM 出力全体を抑制 |
| 32X 構成 | YM2612 と同じ | PSG、PWM 全体 | PWM 左右を個別に切り替える UI ではない |
| YM2203 | FM 3CH | SSG 全体 | CH Off はキーオフと後続キーオンの抑制。出力だけを消す方式ではない |
| YM2608 | FM 6CH | SSG、Rhythm、ADPCM-B | FM はパン制御。SSG は WASM 出力、Rhythm / ADPCM-B はコアの出力合成を制御 |
| YM2610 / YM2610B | 利用可能な FM CH | SSG、ADPCM-A、ADPCM-B | 通常 YM2610 の未使用 FM CH は UI 対象外。音源別マスクを WASM / コアへ渡す |
| AY8910 / YM2149 | AY 3CH（専用モニター） | AY 全体、併用 OPLL 全体 | AY のミュートマスクをコアへ渡す。OPLL は複数チップミキサーで制御 |
| YM2151 | 8CH の共通ボタン追加済み | 併用 Sega PSG 全体 | コア出力のマスクで制御。ミュート CH のフィードバック計算も続ける |
| YMF262 | 18CH の共通ボタン追加済み | 併用 Sega PSG 全体 | 4op はペア単位。リズムは CH7～9 のグループ単位 |
| YM2413 | 単独再生の9CHボタン追加済み | 併用 Sega PSG 全体 | リズムは CH7～9 のグループ単位。MSX 複合 UI のCH接続は別課題 |
| YM3526、YM3812 | 対象チップ自身の CH 別 UI は未対応 | 併用 Sega PSG 全体の API あり | `setPsgMuted` は対象 FM チップをミュートする機能ではない |
| Y8950 | FM CH 別 UI は未対応 | 併用 Sega PSG 全体の API あり | Y8950 自身の ADPCM 独立切り替えは未対応 |
| YMF278B | FM / PCM CH 別 UI は未対応 | 併用 Sega PSG 全体の API あり | OPL4 自身の FM / PCM 切り替えは未対応 |
| MSX 複合構成 | 共通 CH 別 UI は未対応 | エンジンには AY・OPLL・Y8950 の制御あり | `sourcesForChip('msx')` は空配列。共通ボタンには未接続 |

「Play only」は解析・編集画面の対応範囲を示すもの。
現在はこれらのチップで `createChannelMonitorState()` が空配列を返すため、
共通の CH ボタンも作られない。音源別ボタンの定義と CH モニターが結びついている点は、拡張時の整理対象。

## 各層で実際に変更している場所

### Analyzer の UI とレジスタ処理

[vgm_analyzer.js](../vgm_analyzer/vgm_analyzer.js):

- `renderMonitorToggles()`：音源別・CH 別ボタンを生成し、インライン再生欄にも複製する。
- `toggleChannelMute()`：CH の状態を保存し、音源へ即時反映する。
- `effectivePanValue()`：ミュート中はパンレジスタの左右出力ビットを落とす。
- `playCurrentVgm()`：再生時の書き込みをラップし、後続のパンや DAC 書き込みにもミュートを反映する。
- `toggleSourceMute()`：PSG、SSG、Rhythm、ADPCM-B、PCM、PWM の音源別 API を呼ぶ。
- `flushPendingAudio()`：生成済みの VgmPlayer queue を破棄し、Worklet にも flush を通知する。
  既に生成した音声へ新しいミュート設定が反映されないための処理。
- `applyAnalyzerMuteToBuffer()`：すべての対象がミュートの場合、出力バッファをゼロにする。

[source_mutes.js](../vgm_analyzer/source_mutes.js) が構成ごとの音源名と API を対応づける。
これは全チップの能力を問い合わせる仕組みではなく、現在の構成名に応じた定義。

### AudioEngine / ミキサー

- [GenesisAudioEngine](../../web/genesisaudioengine.js)：PSG / RF5C164 は生成を続け、混合時のゲインで抑制。
  PWM は保持値の更新を続けつつ、ミュート中の出力をゼロにする。
- [MultiChipAudioEngine](../../web/multichipaudioengine.js)：`setChipMuted(type, index, muted)`。
  ミュート中も各エンジンの `processFrames()` を呼び、ミックスへの加算だけを省く。
- [MsxAudioEngine](../../web/msxaudioengine.js)：AY 全体・AY CH 別、OPLL 全体、Y8950 全体の API を用意。
- [AY AudioEngine](../../web/ay8910audioengine.js)：CH マスクと全体ミュートを組み合わせてコアへ渡す。
- YM2203 / YM2608 / YM2610B AudioEngine：音源別ミュートをビットマスクにして WASM ラッパーへ渡す。

### WASM と音源コア

- [ym2203_wasm.cpp](../../wasm/ym2203_wasm.cpp)：SSG 出力の合成をミュートマスクで制御。
- [ym2608_wasm.cpp](../../wasm/ym2608_wasm.cpp)：SSG 出力を制御し、Rhythm / ADPCM-B は `set_adpcm_mute()` へ渡す。
- [ym2610b_wasm.cpp](../../wasm/ym2610b_wasm.cpp)：SSG 出力を制御し、ADPCM-A / B のマスクをコアへ渡す。
- [ymfm_opn.h](../../src/ymfm_opn.h) / [ymfm_opn.cpp](../../src/ymfm_opn.cpp)：
  `set_adpcm_mute()` と出力側の条件分岐を追加済み。ADPCM の時間進行と出力の合成を分けて扱う。
- [ay8910_wasm.cpp](../../wasm/ay8910_wasm.cpp)：`ay8910_set_mute_mask` を公開する。

したがって「既存コアにミュート機能があるか確認して接続する」だけで実現したわけではない。
既にこのプロジェクトで、必要な出力制御をコアまで追加した箇所がある。

## 現状の注意点

- 「Off 中も内部の演奏を完全に維持する」は今後の目標として適切だが、現在すべての CH で満たしてはいない。
- YM2203 の CH ミュートはキーオンを抑制するため、On に戻しても次のキーオンまでは元の持続音に戻らない場合がある。
- YM2612 CH6 は DAC 値を `0x80` に置き換える。ミュート中の最後の元データを保持して復元する方式ではない。
- FM のパン制御は元の値をモニターに保持して復元する。チップの汎用 CH ミュート API ではない。
- AY 専用モニターのハンドラーは音源 API を直接呼び、共通の `flushPendingAudio()` は呼んでいない。
  ボタン操作から反映までの遅延を統一する場合は確認が必要。
- メソッドが存在することと、対象構成の画面から操作できることは区別する。
- 今回はコード調査のみ。全チップのブラウザー操作や実曲の再確認は行っていない。

## 他チップへ広げる際の作業

- [ ] 既存の CH / 音源別ボタンと同じ UI で、各チップの利用可能な操作を定義する。
- [ ] Play only の CH ボタンを、未実装の音色解析・編集機能から独立して作れるようにする。
- [ ] YM2151 / OPLL / OPL 系の CH 別出力制御をコア・WASM・JS の順に接続する。
- [ ] Y8950 ADPCM、YMF278B PCM など、チップ内部の別音源を個別に切り替えられるようにする。
- [ ] MSX 複合エンジンの既存ミュート API を画面へ接続する。
- [ ] 型名だけでなくインスタンス番号を保持し、同一チップ2基の操作を混同しない設計にする。
- [ ] ミュート前後の出力、他 CH への影響、内部時間、リセット、シーク、queue flush を検証する。

既存の回帰確認の入口:

- [音源別ミュートテスト](../vgm_analyzer/source_mutes.test.mjs)
- [AY / MSX テスト](../../web/ay8910.test.mjs)
- [PWM テスト](../../web/pwm.test.mjs)

今後コア・WASM を変更する場合は必要なビルドを行い、ブラウザー配信用 `docs/js/` と
生成済み WASM も更新する。調査時点では文書のみを変更した。以降の追加実装は下記に記録する。


## S 優先：YM2151 の追加実装

- [x] Play only のまま、通常／インライン再生欄へ CH1～8 を表示。
- [x] `Ym2151AudioEngine.setChannelMuted()` → JS → `ym2151_set_mute_mask` → ymfm を接続。
- [x] ミュート中もクロック・レジスタ書き込み・フィードバックを維持。
      `output()` にもフィードバック更新があるため、単に CH の計算を省かず、ミュート分を破棄用出力へ描画する。
- [x] リセットで WASM ハンドルを再作成した後もミュートマスクを復元。
- [x] 切り替え時に既存の `flushPendingAudio()` を呼ぶ。
- [x] WASM 再ビルドと `docs/js/` 同期。

検証: [ym2151.test.mjs](../../web/ym2151.test.mjs)、[opm_mute.test.mjs](../vgm_analyzer/opm_mute.test.mjs)。
全8CHについて、他CHへの影響と、ミュート解除後の実WASM波形の一致を確認。
既存のリプレイ・シーク・タイマーとエラー表示を合わせて10テスト成功。
ブラウザーでの実操作・実曲は未確認。次は優先度Sの YMF262。


## S 優先：YMF262 の追加実装

- コア、WASM、JS、AudioEngine、通常／インライン再生欄の18CHボタンを接続。
- 4op は CH1+4、2+5、3+6、10+13、11+14、12+15 の有効な接続ペアを扱い、
  どちらかのミュート指定があればペアの出力を抑制する。ボタン状態は各CHへの指定を表示する。
- リズムモードでは CH7=BD、CH8=HH/SD、CH9=TOM/CYM。打楽器5音の独立ミュートではない。
- YM2151 と同様、ミュート分の出力計算も破棄用バッファへ実行し、フィードバック更新を維持する。
- リセット後もマスクを復元し、切り替え時には既存の音声 queue を flush する。
- 配信用 WASM の再ビルドと `docs/js/` 同期済み。

[OPL テスト](../../web/opl.test.mjs) で18CH、6つの4op接続、3つのリズムグループについて、
対象だけの消音・他CHの出力維持・解除後の波形一致を実WASMで確認。
[UI テスト](../vgm_analyzer/opm_mute.test.mjs) は YM2151 と YMF262 の双方へ適用。
関連30テスト成功。ブラウザー実操作と実曲は未確認。次は A 優先の YM2413。


## A 優先：YM2413 の追加実装

- 単独 YM2413 再生に9CHの ON/OFF を追加。通常・インラインの両再生欄に表示。
- コアの出力制御、WASM API、JS、AudioEngine を接続し、配信用 WASM を再ビルド。
- ミュート中も内部計算とフィードバック更新を続け、リセット後にミュートマスクを復元。
- リズムは CH7=BD、CH8=HH/SD、CH9=TOM/CYM のグループ単位。
- AY＋OPLL / MSX 複合画面での OPLL CH 別ボタンは今回追加していない。

[YM2413 テスト](../../web/ym2413.test.mjs) で9CHとリズム3グループの消音・解除後波形一致を検証。
AY/MSX の既存テスト、3チップのボタン生成テストを含め20件成功。ブラウザー実操作・実曲は未確認。
