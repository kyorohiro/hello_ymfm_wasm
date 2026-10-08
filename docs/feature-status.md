# Tetorica 機能対応状況

更新日：2026-10-08。**現在のリポジトリの機能を探す入口**。
機能単位の状態はこの一覧で管理し、細かなチップ条件・設計・作業経緯はリンク先に残す。
公開版と現在のコードは同一とは限らない。再生対応だけで、音色Export・高速シーク・高水準APIも対応済みとは判断しない。

## 状態の読み方

| 項目 | 記録方法 |
|---|---|
| 実装 | 実装済／一部／設計／未対応。「一部」は制限欄も読む |
| 自動検証 | 「テストあり」は対象テストの存在を確認。「成功記録」は実行結果が詳細文書にある。今回の一覧作成では再実行していない |
| 手動確認 | 対象環境・操作・結果が記録された場合のみ確認済。それ以外は未確認／記録未整理 |
| 公開 | アプリ名＋版番号＋確認根拠を記録。「未照合」は未公開と断定せず、現行実装と配布物の対応が不明という意味 |

古いissue内の「予定」「未実装」はその時点の記録の場合がある。現在の状態を変更したらこの一覧を更新する。
音源ごとの細かな対応は既存の[Analyzer対応表](vgm_analyzer/support.html)を参照する。
Playback欄の`Seek cache`表示で高速シークの対応構成を確認できる。
このHTMLは生成物で、原本は[Analyzer画面](vgm_analyzer/index.html)の`chipSupportDialog`。

## VGM Analyzer

以下の各行の手動確認・公開状況は、特記がなければ「記録未整理／現行版との照合未完了」。

| 機能 | 実装・範囲 | 制限・残作業 | 自動検証・詳細 |
|---|---|---|---|
| VGM／VGZ再生・音源別表示・ミュート | 実装済。OPN／OPM／OPL／PSG／PCMなど | 対応はチップ・Dual・併用構成ごとに異なる | [対応表](vgm_analyzer/support.html)、[再生構成判定](vgm_analyzer/playback_core.js) |
| Chip Mixer | 共通PCM部品に移行。ローカル実装。Play/Ch・Effect横のMixerでチップ別Volume／Pan／Mute、Master、チップ設定Reset。再生・WAVに反映 | Game Boyの初期値・Resetは28%、他は100%。Effect On/Off・各値、チップ別音量／Pan／Mute、Masterをローカル保存し、曲変更・再起動で復元。Effect ResetはOff・初期値、Mixer Resetは保存済み全チップとMasterを初期化。今回の保存・Reset追加はローカル実装。既存のDual対応範囲は変更なし。DC除去・自動音量補正は未実装。未公開 | [PCMテスト](vgm_analyzer/playback_mixer.test.mjs)、[実装](vgm_analyzer/playback_mixer.js) |
| S98入力 | 一部。単一YM2203／YM2608／YM2612／YM2151 | 圧縮S98・複数デバイスは未対応。YM2151の追加はローカル版で、npm 0.2.6には未収録 | [入力仕様](../CLI.md#s98-input-and-source-documents) |
| 高速シーク | 一部。OPN／OPM／Genesis構成 | 下の専用表参照。実曲・長時間のブラウザー試聴未確認、公開版未照合 | [成功記録・詳細](issues/seekvgm_save_load_01.md) |
| Note-ish／楽譜表示・MIDI／MusicXML／LilyPond Export | 一部。対応音源の基音・キー区間を抽出 | 原譜の復元ではない。チップごとに除外区間あり | [対応表](vgm_analyzer/support.html)、[MusicXMLテスト](vgm_analyzer/vgm_musicxml.test.mjs)、[LilyPond作業記録](issues/lilypond_export_01.md) |
| MML Export | 一部。OPN、OPM、MSX系の対象形式 | グリッド量子化・リズム等の除外あり | [OPNテスト](vgm_analyzer/vgm_mml.test.mjs)、[OPMテスト](vgm_analyzer/opm_mml.test.mjs)、[MGSDRVテスト](vgm_analyzer/mgsdrv_mml.test.mjs) |
| 音色抽出・スナップショット・ZIP | 一部。TFI／VGI／OPM／SBI | 音色形式に入らない演奏変化・状態は保存しない | 下の音色表参照 |
| Sample Explorer／データ抽出・試聴 | 一部。認識できるPCM／ADPCMデータ。Sega PCMのROM範囲、OKIM6258の時刻付きADPCMキャプチャを追加。波形・保存／ZIP・ステレオ試聴／WAV | Sega PCMは発音時点の設定による1回再生。OKIM6258は最大10秒の試聴・開始前の分周位相は未再現。実ブラウザー試聴未確認・追加分未公開 | [未対応音源・優先順](issues/todo_vgm_01.md)、[Explorerテスト](vgm_analyzer/sample_explorer.test.mjs)、[CLIサンプル仕様](../CLI.md#sample-inventory) |
| PCM／ADPCMの採譜 | 未対応 | 基準音高の推定、ドラム・効果音の扱いが必要 | [対応表のTODO](vgm_analyzer/support.html) |

### 高速シーク：再生対応とは別に管理

保存済みの位置以前のチェックポイントから復元する。約5秒間隔、最大120個／32 MiB。
未到達位置やキャッシュから外れた区間は再演算が必要。未対応構成は従来の先頭からのシークへ戻る。

| 構成 | 高速シーク | 自動検証 | 手動確認 | 公開 |
|---|---|---|---|---|
| YM2612＋Sega PSG／32X PWM／RF5C164（Genesis構成） | 実装済 | [成功記録](issues/seekvgm_save_load_01.md)・[テスト](../web/genesis_state.test.mjs) | 実曲・長時間試聴未確認 | 未照合 |
| YM2203／YM2608／YM2610／YM2610B | 実装済。FM・SSG・搭載ADPCM等を含む | [成功記録](issues/seekvgm_save_load_01.md)・[テスト](../web/opn_state.test.mjs) | 同上 | 未照合 |
| YM2151単体、Sega PSG／Sega PCM／OKIM6258併用 | 実装済 | [成功記録](issues/seekvgm_save_load_01.md)・[テスト](../web/opm_state.test.mjs) | 同上 | 未照合 |
| Genesis／OPN＋OKIM6258 | 未対応 | 従来シークへフォールバック | — | — |
| Sega PCM単体／OKIM6258単体 | Analyzer高速シークは未対応。コア保存APIは実装済 | コアとYM2151併用経路を検証 | — | — |
| OPLL／OPL、AY単体、SCC、HuC6280、NES／FDS、Game Boy等 | 未対応 | チップ別Save／Loadの調査・拡張が必要 | — | — |

同種複数インスタンスや任意のチップ混在を一括対応したわけではない。
OPM追加時の全体回帰は1130件中1129成功・既存skip 1・失敗0（詳細文書の実行記録）。

### 音色Export

| 対象・形式 | 実装 | 制限 | 自動検証・詳細 |
|---|---|---|---|
| OPN FM → TFI／VGI | 実装済。単体／ZIP／時刻指定 | 静的FMパラメータ。SSG・ADPCM・演奏状態は含まない | [スナップショットテスト](vgm_analyzer/fm_snapshot.test.mjs)、[CLI仕様](../CLI.md#all-tfi--vgi-zip) |
| YM2151 → OPM、近似TFI | 実装済。OPM Info・試聴・ZIP／スナップショット | TFI変換は近似 | [OPMテスト](vgm_analyzer/opm_export.test.mjs)、[TFI変換テスト](vgm_analyzer/opm_tfi.test.mjs) |
| OPL系 → SBI | 実装済。SBI Info・試聴・ZIP／スナップショット、CLI | 2op／OPL3 4op。リズム・CSM・PCM等は除外。Furnace実アプリでの確認は未実施 | [対象音源・成功記録](issues/sbi_01.md) |
| OPLI／WOPL出力 | 未対応 | SBI対応とは別作業 | [SBIの実装範囲](issues/sbi_01.md) |

## Playground・音作り・組み込み

画面で選ぶ音源、独立した`createSoundChip()`、Node.js低レベルラッパーは入口が異なる。
WASMが存在するだけでPlayground APIも利用可能とは判断しない。
各行の公開状況は、下の公開記録に明記したもの以外は未照合。

| 機能 | 実装・範囲 | 制限・手動確認 | 自動検証・詳細 |
|---|---|---|---|
| ライブコーディング・埋め込みRuntime | 実装済。FM／PSG／DAC、サンプル、ループ等 | 音源選択によって使えるAPIが異なる。手動記録は未整理 | [Runtime](../web/README.md)、[テスト](../web/playground_runtime.test.mjs)、[examples](playground/examples/README.md) |
| 32X PWM 共通コア | MAME由来のFIFO／周期／ルーティング・PCM・状態復元。VGMはpwmModel: mameで比較可能 | 開発版。Analyzer／CLIのVGM再生はMAME由来方式が既定（cycle基準の振幅）。MegaSynth／MegaSynthNodeはmega32X: true、PlaygroundはuseSoundChip('pwm')。フレーム単位の書き込みと共通Worklet／Audify Transportを追加。PCMサンプル高級APIと実機比較は残作業 | [実装と検証](issues/pwm32x_01.md)、[比較ページ](demos/32x-pwm-compare.html) |
| MegaSynth Mega CD PCM | `megaCD: true`でRF5C164を有効化。`pcm`から8CH・64 KiB RAM・サンプル読込・パンを操作。FM／PSGと共通の出力・FX経路 | npm公開版0.2.6に収録。FMコマンド録音にPCMは含まれない。CDディスク／32X対応は別 | [APIと例](../packages/fm2612/README.md)、[終了・再起動テスト](../web/megasynth.test.mjs)、[実ブラウザー検証](../scripts/check_megacd_browser.cjs)：8CH・左右パン・混合出力・Stop／Reset／再起動を確認 |
| `createSoundChip('rf5c164')` | 実装済。独立PCM音源・RAM・CH制御 | ブラウザー試聴・実曲検証未確認 | [作業記録](issues/rf5c164_01.md)、[テスト](../web/playground_rf5c164.test.mjs) |
| `createSoundChip('ym2608')` | 実装済。FM／SSG／リズム／ADPCM-B | 同梱リズムROM・差し替え対応。同期読み取り／IRQ・サンプル単位予約は未対応。聴感未確認 | [成功記録・制限](issues/playground_ym2608_01.md)、[テスト](../web/playground_ym2608.test.mjs) |
| `createSoundChip('gameboy')` raw API | 実装済。レジスタ操作・4CHの例 | 高水準APIは別。ブラウザー聴感確認記録なし | [成功記録](issues/playground_gameboy_raw_01.md)、[テスト](../web/playground_gameboy.test.mjs) |
| Game Boy高水準API | 即時設定APIへ改訂・自動テスト済。v0.40.11公開報告あり | pulse／wave／noiseの個別即時設定、明示的トリガー、initialize、setNote、raw同期。ブラウザー聴感確認は未実施。duration／自動CH割当は後段 | [設計案](issues/gameboy_api_01.md) |
| Genesis VGM→JavaScriptのPSG変換 | Schedule / Write / HighでFM・DACとPSGを出力。Include PSGで選択 | HighはPSGの個別設定API＋raw fallback、固定クロック。PSG単独Import・デュアルPSGは未対応。未公開・ブラウザー試聴未実施 | [作業記録](issues/genesis_psg_vgm_javascript.md) |
| RF5C164 VGM→JavaScript変換 | Write／High＋raw fallbackでレジスター・RAM転送を出力。単独／YM2612＋DAC＋PSG混在に対応 | 12.5 MHz・単一チップ。liveLoop／FM CH分割対応、RFは共有ループ。非同期タイミング。ScheduleはFM/DAC/PSGに適用（RFはWrite）。最新変更のブラウザー試聴は未実施 | [作業記録](issues/rf5c164_vgm_javascript.md) |
| YM2151 Synth API | npm `tetorica-fm2612` 0.2.11公開（2026-10-08）。8CHの共通Synth・Direct／Worklet／Audify Transport | FM_PRESETS、音名／MIDI・周波数／KC・KF、論理operator順、DT2／LFO／Noise。既存Playground clientの番号・APIは維持。全CH×operatorの発音・音程・Pan・release、公開版の型定義・CoreAudio、X68000 Web例を確認 | [仕様](../packages/fm2612/README.md#ym2151-synth)、[テスト](../web/ym2151synth.test.mjs) |
| 共通チップミキサー | npm `tetorica-fm2612` 0.2.10公開（2026-10-08）。browser MegaSynth／OPN runtime／playground Main・Worker／createSoundChip WorkletでVolume・Pan・Mute・Reset、ID管理 | Game Boy初期値28%。ID省略時の自動採番・readonly chip.id・初期化中のID予約に対応。raw PCMは変更なし。Nodeのデバイス出力は別API。公開版の新規導入・型定義・ブラウザーPCM／Main・Workerを確認 | [仕様](../packages/fm2612/README.md#chip-mixer)、[テスト](../web/soundchip_mixer.test.mjs) |
| Playground useSoundChip | YM2612／YM2203／YM2610の既定FM取得、RF5C164／YM2608／Game Boyの再利用。Main／Worker・型推論対応 | IDによる複数台は未対応。ブラウザー実画面・実音は未確認 | [設計・実装記録](issues/multisoundchip_01.md) |
| 仮想ファイル・Cassette・音色編集 | 実装済。プロジェクト保存、VGMからのTFI取込等 | ファイル編集と元のディスクファイルへの保存は別。手動記録は未整理 | [Cassetteテスト](playground/playground_cassette.test.mjs)、[TFIテスト](playground/playground_tfi_editor.test.mjs)、[取込テスト](playground/playground_vgm_presets.test.mjs) |
| Native Audio Effect | 実装済。WASM FX・ルーティング・Playground接続 | 独立ページはWindows確認記録あり。Playground移行後の試聴は残作業 | [FX一覧・成功記録](issues/native_audioeffect_01.md)、[テスト](../test/playground_native_fx.test.mjs) |
| Tetorica製YM2608リズムROM | 実装済。同梱・差し替え、比較ページで調整／生成 | 元ROMの複製ではない。音色調整は継続 | [ROM説明](../assets/opna-rhythm/README.md)、[比較ページ](demos/opna-rhythm-compare.html)、[作業記録](issues/tetorica_ym2608_rom.md)、[テスト](../web/opna_rhythm_rom.test.mjs) |
| Synthアプリ | 実装済。FM音色編集・TFI／VGI・VGM／VGZ／S98音色取込・鍵盤試聴 | OPN FMと単一YM2151。YM2151はYM2612へ近似変換し、DT2／LFO／ノイズ等は保持しない。S98／OPM取込はローカル追加。ChromiumでVGM／VGZ／S98のYM2151取込・鍵盤発音・失敗時の保持を確認 | [画面](synth/index.html)、[取込テスト](synth/synth_preset_import.test.mjs)、[操作テスト](synth/synth_controls.test.mjs) |
| Node.js例・Web Runtime配布 | 実装済。音源ラッパー・Synth・WASM・使用例 | 高水準Synthの対応はチップごとに異なる | [Node.js例](../examples/nodejs/README.md)、[Runtime](../web/README.md)、[配布説明](../README.md#download) |

## CLI／Node API

| 機能 | 実装・制限 | 検証・詳細 |
|---|---|---|
| `analyze`／`support` | 実装済。メタ情報、再生構成・必要ROM・Export可否の確認 | [仕様](../CLI.md#file-support-report)、[テスト](../test/support.test.mjs) |
| `render` | 実装済。WAV、開始位置・時間・ミュート指定 | [仕様](../CLI.md#wav-start-and-duration)。ブラウザーと同じ全機能を保証するものではない |
| `export`／`score-channels` | 実装済。楽譜・音色・トラック選択 | [CLI説明](../cli/README.md)。形式・チップごとに制限あり |
| `samples` | 実装済。一覧・nativeデータ・対応サンプルのWAV | [仕様](../CLI.md#sample-inventory)、[テスト](../test/sample-wav.test.mjs) |
| `to-json`／`from-json` | 実装済。VGMバイト列を保持するJSON往復 | [仕様](../CLI.md#lossless-vgm--json-round-trip)。固定レイアウト編集。解析サマリーJSONとは別 |
| Node API／共有解析Core | 実装済。ファイル入力・解析・Export・render | [API仕様](../CLI.md#node-api)。Node.js 22以上 |

実際のファイルの可否は、使用する版の`tetorica-vgm support FILE --json`で確認する。
これは構成・Exportの事前判定であり、全コマンドの正常再生や採譜の忠実度を保証しない。

## 公開状況の記録

利用者からの公開報告と、実際に公開・配布物を照合した記録を併記する。CLI v0.2.8とFM2612 v0.2.11はnpm配布物を照合済み。ほかの公開報告はGitHub Pages／itch.ioの配布物を取得・照合していない。
版番号だけを根拠に、後から追加したコードまで公開済みにしない。

| 対象 | 公開報告 | この一覧での扱い |
|---|---|---|
| CLI `tetorica-vgm` | [v0.2.8をnpm公開](https://www.npmjs.com/package/tetorica-vgm/v/0.2.8)（2026-10-08） | latestと公開tarball integrityを照合。共通ミキサーPCM依存を同梱。公開版の新規導入・版番号・Node API解析・Game Boy WAV出力を確認。公開元commit `14ba730` |
| Sound-chip runtime `tetorica-fm2612` | [v0.2.11をnpm公開](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.11)（2026-10-08） | latestと公開tarball integrityを照合。共通ミキサー・Game Boy初期値28%・自動IDとreadonly chip.id・YM2151Synthを収録。公開版の新規導入・型定義・PCM・MegaSynth／Worklet／playground Main・Workerを確認 |
| VGM Analyzer | v0.40.7公開済みとの報告（SBI対応の時期） | 後続のROM・高速シーク等がどの公開版に入ったかは未照合 |
| Playground／Game Boy VGM→JavaScript変換 | itch.io向けv0.40.11公開済みとの報告（2026-09-30） | raw／解説付きraw／高水準API＋raw fallback、チップ別オプション。公開配布物の照合・ブラウザー聴感確認は未実施 |

CLI v0.2.4はcommit `df977a7`を基に、`package.json`／`package-lock.json`の版番号を更新して公開。READMEに共通のチップ対応表とCLI制限の参照リンクを同梱。公開tarballのSHA-1は`8cf98128decca6ef924fa9bbc3c39f78d9fb5228`。
公開前の検証はNode v22.23.3／v25.2.1でCLIテスト各165件成功、Analyzer関連テストは並列数2で1136件成功・任意の外部コンパイラー依存1件skip。`pack:check`とpublishのdry-runも成功。

CLI v0.2.5ではnpm READMEに21行のチップ一覧を直接掲載。`scripts/build_cli_chip_list.mjs`がAnalyzerの対応表からチップ名・再生概要を生成し、`npm run pack`時も同期する。v0.2.4との差分は配布READMEと版番号メタデータのみで、実行コードは同一。生成結果の同期チェック、publishのdry-run、公開版インストール後の解析・WAV生成を確認。公開tarballのSHA-1は`b1a6ff08701f307417e33e6a6a3bd80a083443cf`。

次回公開時も、対象アプリ・版番号・commit・公開URL・同梱した機能・確認結果をここに追記し、該当行も更新する。

## 更新ルールと次の確認

1. 機能の追加／制限の変更時に、この一覧の該当行を更新する。未実装の案は「設計」と明示する。
2. テストを追加しただけなら「テストあり」。実行成功時は詳細issueにコマンド・結果・対象を記録する。
3. ブラウザー手動確認は、環境と操作を記録する。自動テスト成功だけでは手動確認済みにしない。
4. 公開時は[リリース手順](../READMD_RELEASE.md)と合わせて上の公開記録を更新する。
5. チップ別の詳細は既存対応表／各issueを更新する。この一覧に同じ巨大な表を複製しない。

直近の残作業は、高速シークの実曲・長時間試聴、Game Boy変換・高水準APIのブラウザー聴感確認、
現行機能と公開版の照合。その他の提案・保留項目は[issue一覧](issues/)から辿る。

- Playground `createSoundChip`: YM2612／YM2203／YM2610 の独立インスタンス生成を追加。既存の YM2608／RF5C164／Game Boy と合わせ6種類。Main／Worker・Stop・実WASM複数インスタンスを自動検証。追加音源は個別APIで操作し、グローバル `play()` の対象は既定音源のまま。実音試聴は未実施。

- OPN FM `setOperators(channel, entries)`：YM2612 に加え YM2203／YM2608／YM2610／YM2610B に対応。全入力の事前検証と書き込み順を維持。既定・追加音源と Playground 補完に反映。

- `useSoundChip()` は YM2612／YM2203／YM2610 が既定音源と異なる場合も追加生成・再利用可能。既定音源との一致時は既存FMを返す。並行取得・再評価・手動dispose後の再取得・Stopを自動検証。

- YM2612 Playgroundで単一YM2203 VGMをImport：YM2203（FM＋SSG）／YM2612（従来FM変換）を選択可能。YM2203はWrite／音声側Scheduleと1つのliveLoopに対応。元VGMループ地点・CH分割・Highは未対応。

- YM2203 FM＋SSG ImportのHighに対応。Writeと同じレジスター順・待機時刻を維持できる操作をFM／SSG APIへ置換し、特殊操作はraw writeを保持。

- YM2612 PlaygroundでYM2608 VGMの変換先を選択可能。YM2608全音源Write（FM／SSG／同梱ROMリズム／ADPCM-Bデータ転送）を追加。Schedule／Highは今後対応。元クロック・イベント順を保持し、ADPCMデータは.datに保存。

- YM2608全音源VGM ImportにSchedule／Highを追加。ScheduleはADPCMデータを音声側へ事前転送し、元位置でメモリー転送・レジスター操作を実行。HighはWriteと同じ書き込みを再現できる操作のみ高レベル化。単一liveLoop・全体反復。

- Playground `pg.trackAsync()`：liveLoop単位で非同期処理を追跡し、失敗時は待機を解除して元のエラーを報告。Main／Worker対応。YM2608 Write／Highの手動memoryErrorチェックを廃止。
