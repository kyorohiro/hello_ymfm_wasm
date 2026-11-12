# VAB共通APIのexamples反映・PSF対応表記整理（2026-11-12）

- [x] `w/tetorica-fm2612-examples`の現状と公開0.2.40を確認し、依存・lock・説明を更新する。
- [x] 自作の標準VABを使い、WebでVAB読込・Program／Tone選択・明示的な試奏・選択Toneの標準VAB書き出しをできる例を追加する。
- [x] 同じAPI・自作VABを使うNode WAV出力例を追加し、Program／Tone選択と選択Toneの標準VAB書き出しを説明する。
- [x] examplesの一覧・README・検証導線へ接続し、改造しやすい可読ソースと元VABを配布する。外部ゲームデータを同梱・取得しない。
- [x] 英語／日本語READMEの古い「PSF曲再生未対応」表記を、SPU SynthのPreviewとnpmのVAB APIの区別が分かる説明へ修正する。AI向け説明は英語で揃える。
- [x] registryの0.2.40で全Node例・新VABの出力・型／asset・dist／docsを確認する。新Web例は無音headless Chromium／WebKitで、Tone選択・実PCM・書き出し・失敗時保持を確認する。
- [x] 検証記録と完了状況を両repositoryの再開用TODOへ残す。commit／push／npm公開・Pages／itch公開・Tauri更新は行わない。

境界: 先にTODOを残して進める。音声デバイスへの出力・通常browser／native app／OS音量操作はしない。NodeはPCM／WAV／VABファイルだけを検証し、headlessではアプリ実行前から全destinationをgain0へ接続しChromiumはmuteも併用する。既存の固定SDK／WASMを再ビルドしない。

検証: [ps1_vab_examples_verification_01.json](ps1_vab_examples_verification_01.json)。examplesは公開0.2.40へ更新し、全51Node例、新VAB3Tone、Chromium／WebKitの新例2経路＋既存SPU4経路が成功。dist／docs全1,554ファイルのbyte一致とnpm全1,253ファイル保持、324ローカルリンクを確認。公開・commit／pushは未実施。
