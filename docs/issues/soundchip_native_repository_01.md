# tetorica-soundchip-native の初期集約

作業場所: `w/tetorica-soundchip-native/`（独立した Git リポジトリ）

## 方針

音源コアと C/C++ 接続コードの編集元を `tetorica-soundchip-native` へ集約する。
利用側には版・SHA-256 を固定した自己完結の配布 ZIP を取り込み、ソースとライセンスを保管する。
submodule、ビルド中の GitHub 取得、隣接 checkout の必須参照は導入しない。

利用側に残るコピーは配布用スナップショットとして扱い、そこで独自の修正を蓄積しない。
配布元を更新しても利用側は以前の版を使い続けられるため、リポジトリ間の同時更新は不要。

## 収録したもの

- [x] Playground の追加生成22種類に必要なコアと、Native の既存 C++ 接続原本。
- [x] ymfm を共通の `vendor/ymfm/` へ集約。Native DX7 の6ファイル差分は別途保持。
- [x] チップ別の source / license カタログ、取得元・版・SHA-256 の原票。
- [x] WASM の27 artifact 用ビルド手順。JS Synth / AudioWorklet / UI は利用側に残す。
- [x] Native YM2612 の独立 CMake target と PCM / timer / state / allocation 試験。
- [x] 版固定の source ZIP と、その source ZIP 自体を内包する WASM ZIP の生成。

Native の独立 build target は、まず YM2612（ymfm）だけ。他の21種類はソース収録済みの移行用原本で、SDK単独の target 化は未完了。
WASM の全27種類が再ビルド・実行検証済みという意味ではない。

## 検証

- 新リポジトリ内の CMake Release build と CTest が成功。
- 新しい Native YM2612 build と既存の実WASMを比較し、198ケース・1,216,512ステレオフレーム、status / IRQ / read で差分0。
- YM2612 の WASM を新リポジトリ内の source だけでビルド。compiler / source / output hash を記録。
- DX7 の WASM も独立ビルド成功し、既存の生成物と SHA-256 が一致。
- source / WASM ZIP の source・license参照、全payload hash、内包 source ZIP の一致を確認。
- ZIP を独立した `/private/tmp` 配下へ展開し、親・隣接リポジトリの source / include を使わず Native CMake Release / CTest と YM2612 WASM ビルドに成功。
- 配布WASM・独立再ビルドWASMの両方で、同期read・発音PCM・reset・状態保存／復元後のPCM完全一致を検証。配布監査ツール自体の試験も18件成功。

取り込み元 Tauri のルートと一部 Native 接続ファイルにはライセンス宣言がなかった。
Native のカタログへ未確定として記録し、vendor の BSD / LGPL 等から推定していない。
公開前に未記載ファイルの由来・利用条件を確定する必要がある。元ソースへの宣言追加や再ライセンスは行っていない。

配布 ZIP の別フォルダーへの展開・再ビルド試験は、新リポジトリの `tests/check_standalone_release.py` で実施する。
詳細と再現コマンドは新リポジトリの README / `docs/releases.md` を参照。

## 次の段階

- [ ] 既存アプリの YM2612 一種類を配布スナップショットへ切り替え、従来出力と配布物を比較する。
- [ ] 残りの Native コアを順に独立 target 化し、利用側の編集元を移す。
- [ ] 共通低レベル ABI と JS adapter の境界を揃える。WASM の同期 `read()` / PCM generate は維持。
- [ ] 全低レベル API の Native adapter 公開と、JSパッケージの名称・分離を検討する。

既存 `tetorica-fm2612` / Playground Tauri の参照先は、この初期集約では変更していない。
Rust のスケジューラー、owner / COW RAM / 予算・回収、CPAL、ホストFXは Tauri 側に残す。
新リポジトリへの commit / push / GitHub 公開は行っていない。
