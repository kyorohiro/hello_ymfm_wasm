# NES＋FDSのNative音声対応

2026-10-22。TauriのNativeバックエンドへ、現在のNES APU＋FDSを移植する。
Native対応を先に完成させ、この時点ではBrowser版のJSを比較基準として維持した。
その後のBrowser／packageへのWASM対応は[作業記録](nes_wasm_01.md)にまとめる。

## 音源コア

- JSNES APUと、fixNES由来のFDS JavaScriptを直接C++へ移す。別のエミュレーターへ置き換えない。
- Pulse 2声、Triangle、Noise、DMCとFDS。CPU・PPU・ROMは不要。
- JSの32 bit演算、frame counter、envelope／sweep、LFSR、DMCのメモリー取得と64 KiB RAM、非線形mixを保持する。
- FDSのwave／modulation RAM、変調・envelope・divide-by-16処理、2 kHz low-pass／20 Hz DC除去を保持する。
- APU＋FDSを一度Float32へ丸め、その後10 Hz DC除去を通す。既存JSの丸め位置も比較対象とする。
- 基準clockのNTSC／PAL周期を保持し、APIのclock変更は既存ChipClockResamplerと同じratio・平均・hold処理を使う。
- 固定配列を使い、生成・レジスター書込み・RAM転送・reset・gate-off中のメモリー確保／解放を避ける。

由来・ハッシュ・原典JSをTauriの`src-tauri/native-nes/`へ保存する。
JSNESのApache-2.0、FDSのMITライセンスとJSNESの著作者情報をアプリへ同梱する。
FDSの音量・アナログ特性は現在のJSと同じ近似であり、実機の校正済み出力を意味しない。

## Nativeへの接続

- `mode:'nes'`ではNES＋FDSだけを生成し、YM2612／PSG／DX7を生成しない。
- Main／Workerとも`nes`と`await useSoundChip('nes')`で同じ主音源を使う。追加の独立インスタンスはWeb Audioを使う。
- 既存NesApuSynthのレジスター生成、KeyboardのChip／CH選択、Operatorsの編集・試聴を再利用する。
- 演奏時刻・owner取消し・手動試聴のleaseは音声側で処理する。手動で保持しているCHを古いscript命令や解放で上書きしない。
- `$4015`の共通enable maskでは他CHのleaseを保持し、完了したDMCを別CHの操作で再スタートしない。
- Nativeの適用済み状態を読み、予約済みのWorkerの論理状態と混ぜない。表示の読取りが演奏命令を発生させない。
- UIの部分編集は、直前のUI命令の適用を一度の非同期要求で確認してから結果を返す。音声callbackはUIを待たない。
- Stopは発音と未来の命令を止め、RAM・FDS波形／変調表・設定・clockを保持する。resetはRAMと波形を初期化する。
- 共通ミキサー・FX／liveFx・sample／noise・master音量・停止fade・最終出力monitor／録音へ接続する。

Web Audioが既定。Nativeの対応modeにはGenesis／Mega CD／NES＋FDS／DX7を表示する。

VGM取込みは、基準clockが1,789,773 HzのときだけNativeの主音源を借用する。
Raw／Readable／Highとも、RAM転送・書込み・待機の順序を維持する。
終了時は使用したCHだけを解放し、共有音源を破棄しない。古いHot Runの終了処理が新しい演奏を止めないleaseを使う。
PALやそれ以外の基準clockは既存の独立音源経路を維持し、Native選択中はWeb Audioを案内する。
Nativeセッションの基準clockはNTSC固定で、APIのclock変更はその上の速度変更として扱う。

## 検証

C++と既存JSのPCM、Rustの命令・所有権・停止、mockしたNative IPCを通す
Chromium／WebKitの画面操作を分けて確認する。PCM fixtureとBrowser確認は音声デバイスを開かない。
実機での発音・聴き比べ・負荷確認は未実施。

初回のRust全体テストでは、旧Mega CDテストの「NESは未対応」というassertionが残っていたため、
既定出力を一度開いた。音符の発音はしておらず、失敗後に出力は破棄された。
この拒否テストを常に無効なmode名へ修正した。実機デバイステスト4件は引き続きignoredとして扱う。

```sh
node scripts/check_native_nes.mjs --out /private/tmp/native-nes-parity.json
node --test web/native_genesis*.test.mjs web/playground_runtime.test.mjs web/playground_native_voice_inspector.test.mjs web/playground_nes.test.mjs web/nesapusynth.test.mjs docs/playground/playground_keyboard_routing.test.mjs docs/playground/playground_mode_keyboard.test.mjs docs/playground/playground_execution.test.mjs
node --test docs/playground/nes_vgm_import.test.mjs docs/playground/playground_vgm_import.test.mjs docs/playground/playground_vgm_import_ui.test.mjs
node scripts/check_playground_native_backend_browser.cjs --out=/private/tmp/native-nes-browser
```

Tauriリポジトリーから:

```sh
python3 scripts/sync_native_nes.py --check --source ../..
python3 scripts/import_release.py --check
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml
```

## 2026-10-22の結果

- C++／既存JSのPCM比較: 44,100／48,000／96,000 Hz、72ケース、710,784ステレオフレーム。最大差0。
- JS単体テスト: 351件成功。Main／Worker、取消し・Stop、Keyboard、FDS編集、VGM生成を含む。
- Rust全体テスト: 129件成功、失敗0、実機デバイステスト4件ignored。Workerのscoped Stopが未所有の試奏音を止めない回帰テストも含む。
- 配布用データでChromium／WebKitの全体確認に成功。Native IPCはmockし、Main／Worker、6CHのKeyboard、Operators、VGMのRaw／Readable／High、PALの案内、monitor・録音、mode／backend切替を確認した。Genesis／Mega CD／DX7の既存確認も成功。page errorはなく、Native経路のAudioContext／AudioWorklet生成は0。
- 原典スナップショット: 15ファイルのハッシュ一致。
- Native用配布データ: 792ファイル。SHA-256 `808dca7560d56f3688c0715dc5d1082b0d858b5ee81ac4287000da7be0e2350d`。
- Tauriのoffline・lockedビルド成功。

PCM比較の詳細は[検証データ](native_nes_validation_20261022.json)に保存する。
