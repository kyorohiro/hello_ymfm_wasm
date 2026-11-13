# DMG Synth：表示・編集・鍵盤のCH選択を一本化（2026-11-13）

`Code channel` と `VGM view` を分けず、共通の `Synth (Round robin) / CH1 / CH2 / CH3 / CH4` を選ぶ。表示・編集・鍵盤の対象を同じ選択で把握できるようにし、CodeのRun／VGMの再生位置／作者音色を選択だけで壊さない。

- [x] 既存のCode Live／VGM Live・Pause試奏・Capture・round robinの所有権と状態を調査し、共通選択の状態遷移を定義する。
- [x] モニター上に共通selectorを一つ置く。Code channel／VGM viewを表示から取り除き、出力元（Synth／Code／VGM）は短い状態表示へまとめる。
- [x] Synthは共通の作者音色と従来のsource別round robin。CH1–4は対応するphysical CHの表示／設定／鍵盤対象に揃える。CH選択だけでは他CHの値を統一せず、Runや発音を再初期化しない。
- [x] VGM再生中は選択CHを観測し、Pause中に同じCHで試奏する。Synthへ戻ると作者音色、Captureは作者の保存と共通選択を一貫して更新。Live Off・停止・再開・seek・Codeとの切替でも選択が食い違わないようにする。
- [x] Node／実WASM、出力gain0のheadless Chromium／WebKitで、idle／Code／VGM／Pause／Capture・選択の往復・CH間の値保持・Keyboard所有権・390pxを確認する。
- [x] README／CI／可読配布ZIP／検証記録を更新する。公開chip API／WASM／nativeは根拠なく変更せず、commit／push／公開／実聴は行わない。

Pulse CH1／CH2、Wave CH3、Noise CH4というphysical channelの役割を維持する。Synthのround robinは選択sourceのvoice poolを使い、CH1 Sweepの制約も保つ。VGMのmute操作は再生mix用のまま独立させる。

共通選択はCodeが直接書き込むCHの変更命令ではなく、表示・手動編集・鍵盤の対象を選ぶもの。Code側の明示的なCH指定は保つ。4CHの作者設定はページ内セッションで保持し、Save sound／JSON exportは選択したCHの通常の単一音色を保存する。再読み込みは従来の単一音色から4CHを再構成し、新しいbank保存形式や公開SDK APIは追加しない。

検証: `npm run test:dmg-synth` 231件PASS。最終配布物で8profile × headless Chromium／WebKitがPASS（出力gain0、実聴なし）。1240px／390pxの画像を確認。ZIP内128ファイルが検証したstageと一致し、実行JS／CSS 23ファイルは元の可読ソースと一致。詳細は [検証記録](verification_dmg_synth_unified_channel_20261113.json)。
