# Tetorica 機能対応状況

更新日：2026-09-29。**現在のリポジトリの機能を探す入口**。
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
| S98入力 | 一部。単一YM2203／YM2608／YM2612 | 圧縮S98・複数デバイスは未対応 | [入力仕様](../CLI.md#s98-input-and-source-documents) |
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
| `createSoundChip('rf5c164')` | 実装済。独立PCM音源・RAM・CH制御 | ブラウザー試聴・実曲検証未確認 | [作業記録](issues/rf5c164_01.md)、[テスト](../web/playground_rf5c164.test.mjs) |
| `createSoundChip('ym2608')` | 実装済。FM／SSG／リズム／ADPCM-B | 同梱リズムROM・差し替え対応。同期読み取り／IRQ・サンプル単位予約は未対応。聴感未確認 | [成功記録・制限](issues/playground_ym2608_01.md)、[テスト](../web/playground_ym2608.test.mjs) |
| `createSoundChip('gameboy')` raw API | 実装済。レジスタ操作・4CHの例 | 高水準APIは別。ブラウザー聴感確認記録なし | [成功記録](issues/playground_gameboy_raw_01.md)、[テスト](../web/playground_gameboy.test.mjs) |
| Game Boy高水準API | 初版実装・自動テスト済 | pulse／wave／noise、initialize、setNote、raw同期。ブラウザー聴感確認は未実施。duration／自動CH割当は後段 | [設計案](issues/gameboy_api_01.md) |
| 仮想ファイル・Cassette・音色編集 | 実装済。プロジェクト保存、VGMからのTFI取込等 | ファイル編集と元のディスクファイルへの保存は別。手動記録は未整理 | [Cassetteテスト](playground/playground_cassette.test.mjs)、[TFIテスト](playground/playground_tfi_editor.test.mjs)、[取込テスト](playground/playground_vgm_presets.test.mjs) |
| Native Audio Effect | 実装済。WASM FX・ルーティング・Playground接続 | 独立ページはWindows確認記録あり。Playground移行後の試聴は残作業 | [FX一覧・成功記録](issues/native_audioeffect_01.md)、[テスト](../test/playground_native_fx.test.mjs) |
| Tetorica製YM2608リズムROM | 実装済。同梱・差し替え、比較ページで調整／生成 | 元ROMの複製ではない。音色調整は継続 | [ROM説明](../assets/opna-rhythm/README.md)、[比較ページ](demos/opna-rhythm-compare.html)、[作業記録](issues/tetorica_ym2608_rom.md)、[テスト](../web/opna_rhythm_rom.test.mjs) |
| Synthアプリ | 実装済。FM音色編集・取込・鍵盤試聴 | チップ別Runtime APIとは別の画面。手動記録は未整理 | [画面](synth/index.html)、[取込テスト](synth/synth_preset_import.test.mjs)、[操作テスト](synth/synth_controls.test.mjs) |
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

会話での利用者からの公開報告を転記。今回はnpm／GitHub Pages／itch.ioの配布物を取得・照合していない。
版番号だけを根拠に、後から追加したコードまで公開済みにしない。

| 対象 | 公開報告 | この一覧での扱い |
|---|---|---|
| CLI `tetorica-vgm` | v0.2.1公開済みとの報告 | `package.json`も0.2.1。ただし公開後の変更を含む現行コードとnpm配布物の同一性は未照合 |
| VGM Analyzer | v0.40.7公開済みとの報告（SBI対応の時期） | 後続のROM・高速シーク等がどの公開版に入ったかは未照合 |
| Playground／Game Boy raw対応のリリース | v0.40.8予定の後に公開済みとの報告 | 機能ごとの配布物確認は未実施。高水準Game Boy APIは設計段階 |

次回公開時は、対象アプリ・版番号・commit・公開URL・同梱した機能・確認結果をここに追記し、該当行も更新する。

## 更新ルールと次の確認

1. 機能の追加／制限の変更時に、この一覧の該当行を更新する。未実装の案は「設計」と明示する。
2. テストを追加しただけなら「テストあり」。実行成功時は詳細issueにコマンド・結果・対象を記録する。
3. ブラウザー手動確認は、環境と操作を記録する。自動テスト成功だけでは手動確認済みにしない。
4. 公開時は[リリース手順](../READMD_RELEASE.md)と合わせて上の公開記録を更新する。
5. チップ別の詳細は既存対応表／各issueを更新する。この一覧に同じ巨大な表を複製しない。

直近の残作業は、高速シークの実曲・長時間試聴、Game Boy高水準APIの設計具体化、
現行機能と公開版の照合。その他の提案・保留項目は[issue一覧](issues/)から辿る。
