# HuC6280 Synth: VGM channel On / Off and compact transport controls

開始: 2026-11-14。[仕上げTODO](todo_huc6280_synth_finish_01.md)のCH別On／Off工程。

- [x] VGMのCH1–CH6へ独立したOn／Offを追加する。初期値は全CH On。
      通常Synth／Code／Pause試奏の音には適用せず、VGMの聴取用出力だけを変更する。
- [x] 既存HuC6280AudioEngine.setChannelMutedを利用し、音源レジスタ、
      発振器・Noise・DDA・CH2→CH1のLFO・観測snapshotを書き換えない。
      DMGと同様、生成済みPCMは保持し、次の未生成PCMから反映する。
      Pause／Resume、Stop／Play、曲切替、非同期起動でも最新のCH設定を保つ。
- [x] Channel／Auto update／CaptureをVGM・Play／Stopと同じコンテナ内へ移し、
      Sounds from VGMより前へ置く。共通Channel選択は通常／Codeでも表示する。
      音色抽出・Wave / PCM: keep loudest volume variant・Menu入口は維持する。
- [x] CH On／Offは表示対象のChannel選択と区別する。Focusを残さず、
      キーボード操作、狭い画面、Pause試奏・Captureを妨げない。
- [x] Node／実WASM配列で全OnのPCM互換、各CHの出力分離、LFOを保つMute、
      Noise／DDA、Pause位置・未消費PCM、古い非同期処理の破棄を検証する。
- [x] 独立ZIPのChromium／WebKitを無音で確認し、既存Code／Live／Capture／
      再生／音色抽出を回帰確認する。README／CI／検証記録を更新する。

Seek・再構築cache・VGM再生中の直接編集・新しいnative APIは今回は含めない。
物理音声、ユーザー保存データ、commit／push／公開、Tauri反映には触らない。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_channel_mixer_20261114.json)。Node 353/353、
独立ZIPの全6スイートをChromium／WebKitで無音検証し138/138項目成功。
1240px／390pxの表示と、終了時のリソース解放を確認済み。
WASM・SDK・音量補正は変更なし。実聴・実ゲーム比較・長時間試験は未実行。

確認手順: Menu → Import → VGM / VGZ… → Play → VGM outputのCH1–CH6を切り替える。
Channel／Auto update／Captureは同じコンテナ内。出力をOffにしても元の設定表示は保持する。
Pauseの選択CH試奏やCaptureは、このVGM出力スイッチとは独立。
次はSeekと必要な再構築キャッシュ。Tauri反映・公開は未実行。
