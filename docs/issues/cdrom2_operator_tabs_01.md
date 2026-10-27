# PC Engine CD-ROM² source tabs

Date: 2026-10-28

PC Engine CD-ROM² modeへ、既存のHuC6280 PSGと並ぶMSM5205 ADPCM／CD-DAタブを追加。
3系統の構成を、Run前から見た目で確認できる。通常のPC Engine mode等では追加2タブを隠す。

- HuC6280 PSG：既存の6CH音色編集・試奏を維持。
- MSM5205 ADPCM：mono／4bit／64KiB RAM、使用量、rate、clock、nibble位置・範囲、decoder方式、状態。
- CD-DA：44.1kHz／16bit／stereo、track、再生位置・長さ、準備済みPCM容量、出力rate、状態。

新2panelはread-only snapshot。開いた時、Refresh、画面復帰、再生lifecycle通知で一度だけ読む。
定期polling・enterframe同期は追加しない。状態参照は既存endpointだけを使い、
AudioContext／Worklet／Native sourceを作成せず、音量・再生・パラメーターを書き戻さない。
未準備なら仕様情報とNot initializedを表示。閉じた後、Stop後、旧Runの遅延応答は無視する。
再生deviceの2panelへGuitar Keyboardを表示せず、HuC6280の試奏は従来通り。

実装は`playground_cdrom2_audio_panels.js`、host用`runtime.getSystemAudioState(kind)`、
既存mode／UI／workbench／HTMLへの接続。共通音源・Nativeコード・SDK・Mixer値は変更なし。
キャッシュは`cdrom2-panels-1`。Playground ZIPへ同梱し、Tauri frontendにも取り込み済み。

## Validation

Web／Playground関連4657件成功。新規はruntime observer12、panel8、workbench1。
最初の大量並列試験では既存Workerの300ms期限試験が1件timeoutしたが、単独103件と
並列数4での全4657件は成功。製品コードとその既存試験の内容は変更していない。
全mode型fixture、npm開発配布物の367宣言生成・照合、SDK CI guard105件も成功。

Chromium／WebKit × desktop1280×900／compact390×844の4構成と、通常PC Engineの2確認が成功。
Run前のタブ切替・RefreshはAudioContext0／Worklet0／音声message0。
再生中の参照message4個はすべてstate読取だけで、hidden／visibleの定期読取なし。
実starterの再生状態、RAM／rate／track／位置、Stop後の未準備表示、Keyboardの表示先を確認。
全280served sourceのhashが最終treeと一致。192runtime assetがflat ZIPとも同hash。
8画像を保存し、desktopのMSM5205とcompactのCD-DAを目視確認。物理音声出力はmute。

同名JSONと`cdrom2_operator_tabs_01_browser.json`に結果を保存。
ZIP全998filesとstage、Tauriの997effective files・lock・ZIPをbyte照合済み。
Native source ZIP1976files／全24offline source pinを検証。
commit／push／tag／公開操作は行っていない。

Build Desktop `v0.91.2+test`は、先にpushされたMSM5205実装の確認として全5構成が成功。
macOS ARM／Intel、Windows x64、Linux x64／ARMのテスト・安定性試験・配布物作成を完了。
この追加UIはそのtagに含まれず、次のcommitで取り込む。

CIの全job／step結果は[cdrom2_ci_v0912_test.json](cdrom2_ci_v0912_test.json)へ保存。
