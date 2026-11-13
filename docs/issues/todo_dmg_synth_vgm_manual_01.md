# DMG Synth：VGMと手動操作の共存（2026-11-13）

自動演奏はVGMまたはCodeのどちらか一つ。どちらの実行中も、つまみ・音色選択・鍵盤を同じ音源へ反映できるようにする。VGMとCodeを同時には実行しない。

- [x] 再生用APUへの手動書き込み経路を設け、VGMとUI・鍵盤を同じ4CHで競合させる。同じレジスターは後の書き込みを優先し、表示も実際に反映した順序を追う。表示上の古い値を、他フィールドへ書き戻さない。
- [x] CH指定の編集・鍵盤とSynthのsource別round robinを再生中にも許可する。選択切替や手動操作ではVGMの位置・Runを止めず、VGM／Code切替・Stop・project置換だけで演奏元を切り替える。
- [x] VGM先読みを鍵盤向けに短縮する。末尾のPCMが生成済みの短い区間とAPU電源Off中は新規介入を受け付けず、元の曲の終了時刻を保つ。生成済みPCMの破棄による時間飛びを避け、有限の遅延、EOF直前、Pause／Resume、seek／取消時の扱いをテストする。
- [x] 新しいVGMの発音を、古い鍵盤のKey UpやPitch復帰で切らない。Wave RAM更新は対象CHに限定し、他CH・曲の進行を保つ。Seek／曲変更／Stopで手動の所有権を整理する。
- [x] Codeと手動操作の既存機能、作者音色の保存、Auto update Off、paused試奏／Capture、mute、seek、Filesを回帰確認する。
- [x] Node／実WASMと、出力gain0のheadless Chromium／WebKitで検証し、README・CI・可読配布ZIP・検証記録を更新する。実音の出力・commit・push・公開は行わない。

再生中の一時的な介入は元VGMへ保存しない。CH表示での手動編集は再生APUへの変更として扱い、停止後の作者プリセットは保つ。Synth表示の作者編集とFilesからの音色ロードは作者側にも残す。Pause中のCH試奏・Captureは既存の凍結snapshotを使い、曲の聞こえていないPCMを保持する。Seek成功は元VGMの状態へ再構成し、手動介入は持ち越さない。

検証完了: Node 258件PASS。C候補で9profile × Chromium／WebKit（18実行）を確認し、最終Dの表示修正後にmanual／Code／Channel／Captureの4profile × 両ブラウザ（8実行）を確認。最終ZIPは `release/tetorica_dmg_synth_dmg-vgm-manual-20261113d_itch.zip`。実行JS／CSS 24ファイルは可読ソースと一致し、ZIP内129ファイルは検証したstageと一致。全ブラウザはgain0で実行し、実聴は行っていない。詳細は [検証記録](verification_dmg_synth_vgm_manual_20261113.json)、実行ログは `build/verification/dmg-vgm-manual-20261113/`。
