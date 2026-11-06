# C64 SID: Playground integration map

## 再開時の前提（2026-11-06）

全体TODOは [todo_sid_01.md](todo_sid_01.md)。初回は `chips/m6581`（zlib license）を使う
Native／WASMと、独立したブラウザー検証ラボ `docs/playground/sid-lab/` を作る。
通常Playgroundのmode／公開APIへの接続は次段階で、このメモはそのための調査結果。
既存SDK snapshotへ直接追加せず、固定revision・license・再ビルド手順を保存する。
`.sid`の曲再生、C64 CPU／CIA／ROM、VGMへの独自コマンド追加は初回の対象に含めない。

## 初回ラボと検証

- SID単体の register read／write、clock、reset、render をNativeとWASMから操作する。
- 自作register列で単音から始め、wave／Gate／ADSR／3声／Sync／Ring／shared filterを確認する。
- core revision、model、clock、sample rate、sampling方式を比較結果へ記録する。
  Native／WASM一致は移植検証であり、実機一致とは区別する。
- `scripts/check_native_snes.mjs` の同一register列・PCM比較、
  `docs/synth-snes/instrument.test.mjs` のrender分割不変性、
  `scripts/check_playground_scsp_browser.cjs` の実WASM／AudioWorklet検証を参考にする。
- 初回ラボは既存PlaygroundのRun／Worker／Cassette／npm APIに接続したとは表示しない。

## 次段階: 通常Playgroundへの最小接続マップ

参照実装はPOKEYのregister API経路。dual／VGM timeline／音色抽出／inspectorはコピー不要。

| 層 | 主なファイル | 追加するもの |
| --- | --- | --- |
| SDK／WASM | `scripts/import_soundchip_sdk.py`, `scripts/wasm_sdk_inventory.mjs`, `scripts/build_pokey_wasm.sh` | 上流SDKにSIDが入った段階で取込・build receipt・exports・licenseを登録。SID build wrapperを追加 |
| low-level JS | `tetorica_src/runtime/pokey.js`, `soundchip.js` | SID class、独立handle、read／write／reset／render、lazy loader |
| Worklet／client | `playground_pokey.js`, `playground_pokey_audio.js`, `playground_pokey_worklet.js`（いずれも `tetorica_src/runtime/`） | 初期化中断、MessagePort、予約実行、Stop、disposeを既存共通処理へ接続 |
| 主音源／Worker | `native_runtime_synth.js`, `tetorica_synth.js`, `playground_runtime.js`, `playground_native_primary.js`, `playground_logic_worker.js` | SID作成、primary API、Main／Workerの直接port、run所有権 |
| options | `playground_soundchip_options.js`, `playground_chip_clock.js` | 採用coreが実際に対応するmodel／clock等を検証。未対応optionを黙って受理しない |
| mode／例 | `docs/playground/playground_mode.js`, `defaults/pokey/index.js`, `playground_mode_examples.js` | C64 mode、自作単音register例、WASM／Worklet URL。専用panelは後続 |
| 型／補完 | `docs/playground/tetorica-playground-globals.d.ts`, `tetorica-playground-pokey.d.ts`, `playground_declarations.js`, `playground_monaco_completion.js` | SID client／options／selected-chip／global。`scripts/build_fm2612_types.mjs` のnpm型と一致させる |
| 配布 | `scripts/runtime_artifact_profiles.mjs`, `runtime_artifacts.mjs`, `sync_web_js_to_docs.sh`, `copy_full_web_runtime.mjs` | full／Playground profile、可読runtime同期、matching core source／license／build情報を同梱 |

`NativeRuntimeSynth` は非OPN主音源のWebAudio共通ラッパー名であり、Native出力対応の意味ではない。
実際のNative backend、キーボード3声割当、高級Synth APIは別途対応する。
通常runtimeの正本は `tetorica_src/runtime/`、配信用コピーは `docs/js/`、WASMは
`tetorica_src/runtime/generated/` → `docs/generated/`。配信用JSだけを直接修正しない。
型確認には `scripts/check_playground_mode_types.mjs` とモード別type fixtureを追加する。

## ラボへのリンク候補（未編集）

推奨位置は `docs/playground/index.html` の `#mainMenu > .toolbar-menu-panel` 内、
`#audioDiagnosticsButton` の直後、`#desktopSettingsMenu` の直前（調査時1754–1755行）。
`SID register lab…` という独立リンクなら、通常modeへの対応と混同しにくい。
既存 `.link-button` のstyleを使い、相対先は `./sid-lab/index.html`。
Webでは別タブで開くと編集中のCassetteを維持できる。元のRunと二重に鳴らさない導線も確認する。

Run file／例一覧は現在のmodeで実行する仮想JSファイルなので、外部ページへのリンクは混ぜない。
`playground_examples.js` も生成物であり、直接のリンク追加先にはしない。
リンクを有効にする際は、ラボの全依存assetがPlayground ZIP／offline配布へ含まれるか確認する。
Tauriへ同梱しない段階では、Desktopにもそのまま使えるリンクとは扱わない。
