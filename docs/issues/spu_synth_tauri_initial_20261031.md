# SPU Synth Tauri 初期構成 — 2026-10-31

ユーザー作成・clone済みの`w/tetorica-spu-synth-tauri`へFM Synth版のシェルを再利用して初期構成を作成。
別repositoryのREADME、`docs/initial_setup_20261031.md`、JSONに実装・検証・残確認を記録した。
アプリ名Tetorica SPU Synth、識別子`net.tetorica.spu-synth`、初期版0.1.0。
first commit／push／タグ／公開は行っていない。

親repositoryの変更はSPU Synthのdesktop-only bridgeと隠しツール欄、対応cache query・包装テスト。
出力切り替え中は新規発音を抑止し、最終gainのPCMを渡す。チップは既存WASM／AudioWorkletのまま。
普通のブラウザではdesktop欄は出ず、ブラウザ版Node70件、最終ZIP由来distの両browser限定回帰に成功。
selectのfocus解放はnative WebKitの確定後へ遅延し、desktop出力欄はadapterへ委譲する。

最終Standalone ZIP：`release/tetorica_spu_synth_tauri-initial-buttons-20261031_itch.zip`。
SHA256：`013d1e13693efa29f8ba5672289919898d709c24803a12b3f3a1b94b116c3457`、46 files。
新TauriのdistはこのZIPを未改変で取り込み、release.lock.jsonで照合済み。

新シェルはPython6／Node35／Rust21件成功、物理device test1件ignored。
macOS debug appの生成・起動、SPU初期化、Native既定デバイス48kHz開始、presetのネイティブ保存を確認。
GUI検証では発音せず、物理音声の実聴はしていない。
Pin／Web Audio復帰の実画面確認は自動操作timeoutで未確定として新repositoryのTODOに残した。
Windows／LinuxのActions・実機確認はfirst commit反映後の別作業。
