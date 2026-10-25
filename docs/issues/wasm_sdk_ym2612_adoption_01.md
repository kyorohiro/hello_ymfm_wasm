# 通常YM2612 WASMの固定SDK参照

日付: 2026-10-25

## 変更内容

本体の`sh scripts/build_ym2612_wasm.sh`を、同梱した固定SDKのWASM用レシピへ切り替えた。
`third_party/tetorica-soundchip-native/`には完全なソース配布物379ファイルを保持する。
ビルド中の取得、別checkout、submoduleや他リポジトリとの同時編集を必要としない。

固定版はTauriと同じSDK `0.1.1`、元commit
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
ZIP SHA-256は`939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`、
manifest SHA-256は`f0ad25ed94c8e028891bcd4601483fcc6b1fc6801b0a19ebb52696cc75d686e2`。
取り込み記録は`third_party/soundchip-sdk.json`。

`scripts/import_soundchip_sdk.py --check`で固定ファイル群を検証してから、
SDKの`build-wasm.sh ym2612`を呼び、既存と同じexport・最適化条件で生成する。
Node.jsがある環境ではSDKの記録処理が入力・出力hashとコンパイラー版を`build-info.json`へ保存する。
相対出力先は呼出し側の作業ディレクトリを基準に解決する。

通常YM2612だけが対象。ほかの音源とNukedのビルド参照は保持し、
それらが使う本体の`src/`・`wasm/`も残す。公開JS API、同期`read()`／`generateStereo()`、
Worklet／Nativeの切替やMixerの数値は変更しない。

## 実WASMの比較

旧レシピの再ビルドとSDK版、リリース済みWASMとSDK版の2組を比較した。
比較器は`scripts/check_ym2612_wasm_sdk.mjs`、永続化した要約と入力hashは
[検証JSON](wasm_sdk_ym2612_adoption_01.json)に記録する。

- 各比較444ケース: 74シナリオ × 3クロック × 2種類のblock分割。
- 各比較11,557,320ステレオフレームと46,229,280個のOPエンベロープ値を比較。
  両ビルドと状態復元・reset後の再生を含む数。補助的なwrapper自己試験のフレームは含めない。
- PCM・4OPの内部エンベロープ・read/status/IRQ・フックと状態bytesの差は0。
- 各比較で自身の状態復元444回、両方向のraw状態復元444回、reset後の継続444回。
  公開JSのopaque snapshotは従来どおり別instanceの状態を拒否する。
- 全6CH、全8algorithm、feedback、LFO、AM/PM、SSG-EG、CH3特殊周波数、
  CSM／タイマー、DAC全256値と9bit制御、pan、address latch、resetを含む。
- 同期API、0フレーム、異常サイズ拒否、借用／コピー／内部envelope出力の一致を確認。

Emscriptenは`6.0.6-git`。生成JSは3組とも同一の34,902bytes。
SDKのWASMは40,357bytes、旧2組は40,341bytesで、WASMバイナリーのhashは異なる。
SDK版ではassertに埋め込まれたソース名が`src/...`から`vendor/ymfm/...`へ変わることも確認した。
バイナリー一致と実行結果の一致を混同しない。

## その他の検証

- SDK取り込み・分離環境でのビルド経路: Python 19件成功。
  Git／npm／downloader／実EmscriptenをPATHから外したfresh copyでも、
  SDKだけから入力を解決できる。改変されたSDKはコンパイラー起動前に拒否する。
- state・timer・frame検証: 41件成功。Worklet処理: 8件成功。
- Chromium／WebKit: 主音源・追加YM2612とNuked対照の各4経路で実Workletを計測。
- 隔離したnpm tarball: 803ファイル、全26WASM engineの読込み、発音、asset URL、型を確認。
- 既存CIと同じVGM mock runner: 185件成功。
- CIへSDK検証と19件のPython試験を追加。今回remote CIの実行はしていない。

配布物を生成する試験と生成済み配布物を読む試験を同時起動したため、
初回のWorklet試験は生成途中のファイルを読んで失敗した。
配布物の生成成功後にその試験だけ再実行し、全8件が成功。製品修正による回避はない。

## 校正記録

生成WASMの更新でAnalyzerの校正ソースhashが変わるため、
PSG／AY／NESとOPNA基準を実際に再測定し`analyzer_psg_levels_03.json`へ保存した。
旧01／02は保持する。02との全測定値・基準・校正値は一致し、差はYM2612 WASMのhashだけ。
生成器の参照と生成JSのコメントを03へ更新し、8個のMixer値とnpm／Playgroundの既定値は維持する。
校正関連17試験と両生成器の`--check`が成功した。

`sh scripts/package_itch_vgm_analyzer.sh ym2612-sdk`も成功し、753件のローカル参照を検証した。
生成ZIPは`release/hello_ymfm_wasm_ym2612-sdk_itch_vgm_analyzer.zip`。
ZIP内のYM2612 WASMと校正モジュールが検証済みの本体ファイルとbyte一致することを確認した。

公開用の手順は[YM2612 WASMのビルド文書](../building_ym2612_wasm.md)に記載。
npm公開・itch.io公開・Tauri同梱frontend更新は今回の作業には含まない。
