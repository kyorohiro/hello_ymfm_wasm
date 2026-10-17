# Playground: 音源別タブと Mixer の追加

作成日: 2026-10-17
状態: 音源別タブ・Mixer を実装。Browser の Main / Worker を検証済み。Tauri 実機の音声出力は未確認。

## 目的と今回の方針

既存の Operator タブは表示名を **YM2612** に変更済み。
これに **Sega PSG / RF5C164 / 32X PWM** を追加し、音源ごとの特徴に合った操作画面を用意する。
共通の **Mixer** では、VGM Analyzer のように SoundChip ごとの音量バランスを調整する。

- 音源別タブ: チップ内部のパラメーター、発音、素材を操作する。
- Mixer: チップの出力へゲインを掛け、音色設定を維持したまま音量バランスを調整する。
- 同じ種類のチップが複数ある場合は、インスタンスを区別する。
- Run で Mixer の設定を初期値へ戻さない。表示値と実際の音量を一致させる。
- 非表示のタブでは継続的な描画・状態取得を止め、最近改善した再生安定性を保つ。

以下に当初の方針と実装内容を記録する。チェック済み項目は実装・自動検証した範囲であり、実機での聴感確認は末尾の制約を参照する。

## タブ構成と配置

音源別の並びは `YM2612 | Sega PSG | RF5C164 | 32X PWM` とする。
Mixer は共通タブとして追加し、既存の Code / Audio / FX Monitor / Console / Shell / Keyboard / Helper を維持する。

現在は Code・YM2612 が主作業領域、Audio 等が下側の Panel という構成。
新しい音源別タブは YM2612 と同じ主作業領域、Mixer は下側の Panel に配置した。
コードや音源編集を見ながら音量を調整できる。狭い画面ではタブ列を横スクロールする。
既存の YM2612 内部 ID に `operator` が残っていることを理由に、一括改名や大規模な構成変更は行わない。

| タブ | 主な役割 | 初期実装の操作・表示候補 |
| --- | --- | --- |
| YM2612 | FM 音色編集 | 既存の Operator・Algorithm・Envelope 編集を維持 |
| Sega PSG | 矩形波とノイズの音作り | Tone CH1–3 の音程・周波数・音量、Noise の種類・速度・音量 |
| RF5C164 | PCM サンプラー | 8ch、サンプル選択、素材波形、開始・ループ位置、再生速度、音量、左右の音量 |
| 32X PWM | PCM 出力設定・状態確認 | 出力ルーティング、PWM 周期、FIFO の空／満、予約データ数 |
| Mixer | 音源間の音量バランス | Master、音源ごとの Volume / Pan / Mute / Solo、レベルメーター |

## 実装前の調査: 再利用できるものと不足

### 共通 Mixer

- `web/soundchip_mixer.js` に `SoundChipMixer` があり、`set / get / reset / list` を提供している。
- 設定は `volume: 0..2`、`pan: -1..1`、`muted: boolean`。Pan は中央で元のステレオ像を維持する左右バランス。
- チップ出力を FX / Master より前で調整する。既存のゲイン変更には約 5ms のランプがある。
- Playground の公開 `mixer` API と Worker から Main への RPC は既に存在する。
- 標準音源の ID は `ym2612 / segapsg / rf5c164 / pwm`。追加音源には個別 ID が割り当てられる。
- 標準 YM2612 と PSG は同じ Worklet 内でゲインを分け、標準 RF5C164 / PWM と追加音源は個別ノードを接続する。
- 現在の `SoundChipMixer` には Solo、メーター、変更通知、設定の永続化がない。接続解除で項目を削除するため、再生成後の設定保持には追加対応が必要。
- VGM Analyzer の Mixer UI は Volume / Pan / Mute と設定保存を提供する。Solo とメーターは新規対応になる。
- Analyzer は `gain`、共通 Mixer は `volume` という API 名を使う。描画・設定ロジックの再利用時に変換を確認する。

### 音源別 API

- Sega PSG は Tone、Noise、音量、raw レジスタ書き込みを提供する。FM のような ADSR や Duty 編集はない。
- RF5C164 は共有 64KiB RAM への素材読み込みと、8ch の `start / loopStart / step / volume / pan` を操作できる。
- PWM はレジスタ読み書きと予約投入が中心。現時点では音階の `play()` や素材の `loadSample()` を提供していない。
- PSG / RF5C164 には UI 用の完全な公開状態取得 API がない。PWM の `getState()` も周期・FIFO 詳細をすべて返すわけではない。
- `useSoundChip('segapsg' / 'rf5c164' / 'pwm')` は標準音源とは別のインスタンスを作るため、チップ名だけでは操作対象を特定できない。

## 音源別タブの追加内容

### Sega PSG

- [x] 対象インスタンスを選択できるようにする。
- [x] Tone CH1–3 に周波数、音名表示、音量、発音／停止の操作を用意する。
- [x] 詳細表示で raw period を確認・編集できるようにする。Hz と raw 値の意味を区別する。
- [x] Noise に White / Periodic、速度 Low / Medium / High / Tone CH3、音量を用意する。
- [x] 音量表示は「大きい値ほど大きい音」にそろえ、raw attenuation は詳細表示へ分ける。
- [x] Noise を Tone CH3 に連動させた場合、その依存関係が画面で分かるようにする。

チップに存在しない Envelope や波形選択を、ハードウェア機能として表示しない。
Noise 設定の書き込みは内部状態を変えるので、画面描画のためだけに再送しない。

### RF5C164

- [x] 対象インスタンスと CH1–8 を選択し、使用状況を確認できるようにする。
- [x] Virtual Files の対応する音声素材を選び、読み込み・試聴できるようにする。
- [x] 素材の波形と開始・ループ位置を表示し、編集できるようにする。
- [x] 再生速度、音量、左右それぞれの音量を操作できるようにする。
- [x] 詳細表示で RAM アドレス、raw step、使用範囲を確認できるようにする。
- [x] RAM の容量超過や、別の素材を意図せず上書きする配置を検出する。

実装上の制約:

- `start` は RAM の絶対アドレスで、256 バイト境界にそろえる必要がある。
- `setChannel().loopStart` は RAM の絶対アドレス。`loadSample()` の同名オプションは素材内の相対位置なので混同しない。
- `step` は raw 再生速度であり、Hz や MIDI ノート番号ではない。倍率表示には素材読み込み時の基準 step が必要。
- 元の素材情報がない raw RAM 書き込みでは、素材名・範囲・基準音高を確実に復元できるとは限らない。不明な値を推測で表示しない。
- 音階で演奏する鍵盤を追加する場合は、素材の基準音高の管理が別途必要。初期実装では速度変更と試聴を優先する。
- ハードウェアの音量値を ADSR として扱わない。読み込み時のアドレス割り当ては UI 側で補う。

### 32X PWM

- [x] 対象インスタンス、左右の出力ルーティング、PWM 周期を表示・操作できるようにする。
- [x] FIFO の空／満、予約データ数、clock / sampleRate 等を確認できるようにする。
- [x] raw レジスタ値は詳細表示にまとめる。
- [x] 出力波形が必要な場合は Audio タブとの重複と負荷を確認し、独立した常時描画を増やさない。

PWM は出力設定と動作確認を中心にする。
素材ファイルの再生、ループ、音階演奏を追加する場合は、別途サンプルプレイヤーの実装として扱う。
RF5C164 と同じサンプラー UI を、そのまま既存 API だけで提供できるとはしない。

## Mixer の追加・修正内容

### 操作と表示

- [x] Master 音量を既存の Master 設定と共有し、どちらから変更しても実出力と表示に反映する。
- [x] 接続中の音源をインスタンス単位で一覧表示する。新しい音源の生成・破棄にも追従する。
- [x] 各行に名前／ID、Volume、Pan、Mute、Solo、左右のレベルメーターを用意する。
- [x] 初期対象の 4 音源に固定せず、DX7 等も既存 Mixer に接続されたものを表示できる構成にする。
- [x] 音源ごとの Volume は既存 API の 0–200% を基本とする。Master の範囲は既存仕様を維持する。
- [x] コードの `mixer.set / reset` による変更も UI に反映し、UI の古い値で上書きしない。
- [x] `list()` に含まれる未接続・事前設定のみの項目は、実際に出力する音源と区別する。

### Mute / Solo

- Mute はチップを停止・リセットせず、出力ゲインで無音にする。解除後も演奏位置を保つ。
- Solo は複数選択可能とし、一つでも選択中なら対象外の出力を抑える案とする。
- ユーザーが明示した Mute と、Solo による一時的な抑制を別に持つ。
- Solo を解除しても、元から Mute していた音源を勝手に鳴らさない。
- Solo 中の音源が生成・破棄された場合も、残った音源の有効な出力状態を再計算する。
- Solo は公開 Mixer API の `set(id, {solo})` で操作できる。

### 設定の維持

- [x] Run の再実行、タブ切替、Stop → Run で同じ論理音源の設定を維持する。
- [x] 破棄した AudioNode や Worker を保持せず、設定だけを再接続先へ適用する。
- [x] 安定した ID と、自動採番される一時的 ID を区別する。同種の別音源へ設定を誤適用しない。
- [x] Master と同様、スクリプトが明示的に変更した場合はその変更を反映する。

現在の Playground セッションでの維持を対象とする。
New Cassette でも出力設定として維持する。再読み込みや Cassette Export / Import をまたぐ保存は追加しない。

### メーターと負荷

- 音源別メーターは各音源の Mixer 調整後・共通 FX / Master 前を基本にし、Master は最終出力のレベルを示す。
- 現在の最終出力 Audio Monitor だけでは、混合前の音源別レベルは取得できない。
- 同じ Worklet 内にある YM2612 / PSG も分離して計測する。必要なピーク集計を音声処理側に追加する。
- UI へ PCM 全体を継続転送せず、小さい集計値を低頻度で通知する。
- Mixer を非表示にしたら、専用の計測・通知・描画を止める。音量・Mute・Solo の適用は継続する。
- 非表示中の周期ポーリングや、タブを開くたびの重複購読を作らない。
- メーター更新頻度は実測で決め、コード編集・メニュー操作中の音切れを回帰確認する。

## 状態同期と実行経路

- [x] UI とスクリプトが同じ音源を操作する。表示用の別音源を自動生成しない。
- [x] 未生成・初期化中・破棄済みを表示し、タブを開くだけで音源の生成やリセットを行わない。
- [x] Main / Worker / 標準音源 / 追加音源のパラメーター変更を追跡する。
- [x] 高水準 API だけでなく raw register / memory 書き込み後の表示も扱う。取得できない情報は不明として示す。
- [x] lookahead の予約値と適用済みの値を混同しない。表示更新のために予約済みデータや演奏時刻を変更しない。
- [x] 音源を切り替えた後に届く古い非同期応答を無視し、別インスタンスの表示や設定を変更しない。
- [x] UI 編集は既存の即時操作経路を基本とし、スクリプト用 lookahead を不用意に加えない。
- [x] Tauri の既存出力経路でも Mixer の結果を反映する。出力先ごとに別の設定を二重管理しない。

状態取得・通知は必要なチップから小さく追加する。
全音源を一括改造する汎用エディターフレームワークは今回の前提にしない。

## 主な変更候補

| 範囲 | 現在の主なファイル | 予定する変更 |
| --- | --- | --- |
| タブ配置・表示 | `docs/playground/index.html`, `playground.js`, `playground_ui.js` | タブ・パネル・可視状態・フォーカスの接続 |
| 既存 YM2612 UI | `docs/playground/playground_operator_tab.js` | 新タブとの接続。既存音色編集は維持 |
| 新しい音源別 UI | `docs/playground/` 内の新規モジュール | PSG / RF5C164 / PWM の専用画面 |
| Mixer UI | `docs/playground/` 内の新規モジュール | 一覧、設定、Solo、メーター、設定維持 |
| 共通 Mixer | `web/soundchip_mixer.js` | 必要な通知・状態管理・計測の接続 |
| 実行管理 | `web/playground_runtime.js`, `playground_logic_worker.js`, `playground_soundchips.js` | 対象インスタンスの列挙、Main / Worker の同期 |
| 標準音源・音声経路 | `web/megasynth.js`, `tetorica_audio_runtime.js` と関連 Worklet | 出力設定・メーター・ライフサイクルの接続 |
| 音源 API | `web/segapsgsynth.js`, `playground_segapsg.js`, `rf5c164synth.js`, `playground_rf5c164.js`, `pwm32x_playback.js` | 不足する状態取得・通知等 |
| Analyzer の参照元 | `docs/vgm_analyzer/mixer_ui.js`, `playback_mixer.js`, `audio_preferences.js` | 既存の操作感と共通処理を参照 |
| 型・配布 | 型定義、Monaco、`docs/js/` の配布コピー、itch / Tauri の配布生成 | 公開 API を変更した範囲を同期・確認 |

変更候補は調査の起点。実際に必要なファイルへ絞り、既存の生成手順で配布物へ反映する。

## 実装順序

1. 対象インスタンスの列挙と、設定・状態を共有する最小限の接続を用意する。
2. Mixer の Volume / Pan / Mute と Master 同期、Run / Stop 間の設定維持を実装する。
3. Solo と音源別メーターを追加し、非表示時の負荷を確認する。
4. Sega PSG タブを実装する。
5. RF5C164 の素材・メモリー管理とタブを実装する。
6. 32X PWM の設定・状態確認タブを実装する。
7. 型・説明・examples・配布物を必要な範囲で更新し、両実行経路を確認する。

段階ごとに既存機能を使える状態で進める。PWM 用の高水準サンプルプレイヤーや、全チップのタブ追加は別の拡張とする。

## 完了条件と検証項目

- [x] 新しい各タブと Mixer が表示され、キーボードでも選択・操作できる。
- [x] 標準音源と同種の追加音源、同種の複数インスタンスを区別して操作できる。
- [x] UI / スクリプト双方の変更で実出力と表示が一致する。UI 更新だけでは音を変更しない。
- [x] Run の再実行、Stop → Run、生成・破棄・初期化失敗で設定の消失や別音源への誤適用がない。
- [x] Mute / 複数 Solo / Solo 中の生成・破棄で、元の Mute 設定と演奏位置を保つ。
- [x] RF5C164 の開始位置制約、ループ、RAM 容量超過、素材衝突を確認する。
- [x] PWM の FIFO 状態確認がデータ投入を妨げず、周期表示と実設定が一致する。
- [x] メーターの左右・Mute 後の値を確認し、非表示・破棄後に専用処理が残らない。
- [x] Main / Worker、lookahead 有効／無効、Run / Stop / liveLoop 切替、Keyboard 試聴を確認する。
- [ ] Tauri 実機の各音声出力先で確認する。Browser と配布物の確認は完了。
- [ ] Tauri 実機で連続再生しながらコード編集・メニュー操作・タブ切替を行い、ノイズ・音切れを聴感確認する。自動テストでは先読み・PCM 発音・即時鍵盤入力を検証。
- [x] 必要な回帰テスト、型チェック、配布生成、ローカル参照チェックを実行する。

## 採用した仕様と残る制約

- 音源別タブは上側、Mixer は下側 Panel に配置。横に収まらないタブはスクロールでき、Code / 音源編集と Mixer を同時に表示できる。
- Solo は共通 Mixer の公開 `set(id, {solo})` に追加。`muted` は手動設定、`list().effectiveMuted` は Solo を含めた実効状態。Main / Worker で同じ意味を持つ。
- 既存の Vol と Mixer の Master はリスニング音量を共有する。コードの `setMasterVolume()` は既存どおり別のゲインで、1 以外なら Mixer に Script gain として併記する。
- 保存範囲は現在の Playground セッション。New Cassette でも出力設定として維持し、再読み込みや Cassette Export / Import には格納しない。設定を初期化する公開操作は既存 `mixer.reset()`。
- 標準音源の ID は変更しない。追加の `useSoundChip(name)` は安定した `${name}:shared` ID とする。この ID は旧版の自動採番から変わるため、コードでは固定文字列より `chip.id` を使う。
- `createSoundChip()` の自動 ID は新しいインスタンスとして扱い、破棄時に音量設定も解放する。明示 ID なら同じ ID の再接続時に設定を復元する。同じ種類という理由では復元しない。
- 同じ ID の再作成は、前のインスタンスの破棄完了を待つ。Worker の先読み中でも別ループの操作や Stop を待ち行列で止めない。
- 音源タブは適用済みのレジスタ状態を約 300ms 間隔で読む。先読み中の未来の値を現在値に混ぜず、読み取りによって予約を進めない。
- 音源別ピークは Mixer 調整後・共通 FX / Master 前、Master ピークは既存ランタイムの最終出力。TFI / VGI のファイル試聴は別ランタイムであり、その個別音源は今回の Mixer 一覧には合流しない。
- Mixer の計測・描画は最大約 15Hz。パネル非表示・ブラウザーのページ非表示で停止する。チップ編集タブの状態ポーリングも同様に停止する。
- RF5C164 の Load は空き RAM に読み込んで選択チャンネルへ割り当てる。読み込み中に対象を変更したら割り当てを行わない。未設定チャンネルのみ試聴用の音量・左右ゲインを初期設定する。
- RF5C164 の raw RAM 上書きは重なった素材の名前・波形情報を無効化する。未知の素材や基準音高を推測しない。RAM の個別解放・圧縮は未対応で、配置はインスタンス再生成まで保持する。reset は既存どおり RAM を保持する。
- UI のパラメーター編集はランタイム上の操作。コードや音色ファイルへの書き戻し、RF の RAM 配置の Cassette 保存は今回行わない。素材ファイル自体は既存の Virtual Files / Cassette で扱う。
- PWM 用の高水準サンプルプレイヤーは追加していない。
- Tauri の macOS / Windows / Linux 実機の出力先切替・聴感確認は未実施。既存の最終出力転送経路を使い、native 側に別の Mixer は追加しない。

## 実装と検証の記録

- 新しい UI: `docs/playground/playground_chip_tabs.js` / `.css`、`playground_mixer.js` / `.css`。
- 管理経路: `web/playground_chip_inspector.js` / `playground_chip_inspector_state.js`。Worker のクライアントポートとは別の管理メッセージで、UI が実際の接続音源を操作する。
- 共通 Mixer: 変更通知・複数 Solo・再接続時の設定復元・表示中のみのピーク計測を追加。Analyzer の既存デフォルトと API 形状を維持する。
- サンプル: `docs/playground/examples/genesis/mixer-chip-balance.js`。Run で UI のバランスを上書きせず、FM / PSG を聴き比べられる。
- Help、公開 Mixer の型、Monaco が読む型定義、パッケージ README を更新。
- 実ブラウザー検証: `scripts/check_playground_chip_tabs_browser.cjs`。Chromium / WebKit × Main / Worker の 4 経路で実 WASM / AudioWorklet を使用する。
- UI / コードの相互反映、標準 PSG と追加 PSG の選択、RF 素材読み込み・ループ波形編集・再生、PWM 設定、実ピーク、Mute / Solo、Master 同期、Stop → Run の設定復元、640px の操作を確認。
- 既存の `check_playground_lookahead_browser.cjs` / `check_playground_panel_browser.cjs` も両ブラウザーで成功。先読み同期、即時 Keyboard、保持中の音、TFI 試聴との共存を確認。
- 生成宣言 210 件と、インストール後の NodeNext / Bundler / Browser の型チェックに成功。
- 全体回帰: `test/*.test.mjs` / `web/*.test.mjs` / `docs/playground/*.test.mjs` / `docs/vgm_analyzer/*.test.mjs` の 2,289 件中 2,288 件成功、失敗なし、任意の外部コンパイラー検証 1 件をスキップ。
- 配布参照: Playground 402 件、共通ランタイム変更の影響を受ける Synth 185 件のローカル参照チェックに成功。
- Tauri 開発プロジェクトへ検証用 ZIP を取り込み、539 ファイルを照合。キャッシュ修正後の `release.lock.json` の識別子は `sha256-ceb4e9b88fd9`。Python 8 件・Node 30 件の既存テストに成功。実機アプリの出力確認とは区別する。
- 外部 `MML2MDR_DIR` を必要とする既存のコンパイラー統合テストは、その環境がないためスキップ。今回の音源 UI / Mixer に関する検証とは別。
- 検証用 ZIP: `release/hello_ymfm_wasm_chip-tabs-dev_itch_playground.zip`。公開・バージョン更新は行わない。

### 更新時のキャッシュ混在による起動失敗の修正（2026-10-17）

`operatorTab.setVisible is not a function` は、新しい `playground.js` と、
同メソッドが存在しない旧版の `playground_operator_tab.js` が混在すると再現する。
エントリーポイントだけを更新しても、URL が同じ依存モジュールは古い HTTP キャッシュから読み込まれる場合があった。

- エントリーポイント、YM2612 タブ、Envelope、TFI エディター、UI、変更した音声依存モジュールの読み込み識別子を `chip-tabs-2` に更新。
- Worker / Worklet の読み込み経路もそろえ、古い Mixer や Inspector が残る経路を修正する。
- ブラウザー向けのランタイム URL 変更は docs への生成時に適用する。Node / npm の元モジュールのクラス同一性は維持する。
- メソッド呼び出しを省略して症状を隠す処理や、ユーザーの保存データを消す処理は追加しない。
- `scripts/check_playground_startup_cache_browser.cjs` を追加。古い HTTP キャッシュを長期間有効なまま保持し、元のエラーの再現と更新後の起動を Chromium / WebKit で確認する。
- Virtual Files のテキスト・バイナリ・空フォルダーと、localStorage / lookahead 設定が更新後も残ることを確認する。
- 修正後の関連回帰 1,580 件・生成宣言 210 件の型チェックが成功。古いキャッシュありの起動検証と、音源タブ / Mixer の Main / Worker 検証も両ブラウザーで成功した。
- ブラウザー用 URL の更新処理は `scripts/version_playground_runtime.mjs` に集約し、同期スクリプトの末尾から適用する。Node / npm の全 5 RuntimeSynth について、直接 import したクラスと Factory のクラス同一性も回帰検証する。
