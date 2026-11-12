# SPU Synth：PSFシークバー（2026-11-12）

- [x] PSF metadataと既存transportを調べ、先頭から無音renderして目的frameへ移動する方式を実装する。元曲の再生状態を残した候補coreを用い、失敗・キャンセルで元位置を失わない。
- [x] 早送りは小さな単位でUIへ制御を返し、進捗・Cancelを表示する。処理時間・一回のrender・保持メモリを制限し、早送りPCMは出力・蓄積しない。
- [x] 曲一覧の再生操作へシークバーを追加する。ドラッグ中は位置を選ぶだけにし、確定時に処理する。PauseからのシークはPauseを維持する。
- [x] 移動先でLive CH・活動・Capture・Pause試奏・編集比較・Resumeが同じ時刻を参照することを確認する。Synth音色・既存出力・選択CH／Dry設定を保持する。
- [x] Node・実WASMで通常先頭再生とのPCM／状態一致、前後移動、失敗、競合、Cancelを検証し、物理出力gain 0のheadless Chromium／WebKitでUIを確認する。
- [x] 説明・キャッシュ・配布ZIP・検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。初版ではシーク用の長時間PCM cache／CPU checkpoint cacheは持たない。

完了：関連Node 267件成功（seek fake 18、controls 6、実WASM 3を含む）。実WASMで通常先頭再生と分割discardのPCM／24stems・voice・RAM・SPU register・trace等を比較し、目的frameとその後4096frameが一致した。CPU GPRは現ABIにgetterがないため直接比較していない。

新seek checkerはChromium／WebKit各8ケース成功。off-grid .28秒=12348frame、Pause／playing／stopped、移動先CH試奏・Capture・編集音色保持、Cancel、候補WASM503、前後移動、Source／Stop、unknown長・Escapeを確認した。既存Playback／Live／Pause試奏／Capture／Code・Filesの5系統も両engine成功。物理出力gain 0・実聴なし。

レビューでmutable beforeSeek cleanupのlate Stop、draft Escape、無操作thumbによるrange固定を修正し、回帰も成功。最終a ZIPは曲長tag説明の一語修正のみで、検証済みapp JS／HTML／CSS／WASM等のRuntimeはbyte一致。変更箇所はREADMEとそのsource manifest／archiveだけで、全ZIPエントリーとCRCを確認した。

検証記録：[spu_psf_seek_verification_01.json](spu_psf_seek_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-seek-20261112-a_itch.zip`（337 files、SHA-256 `f798e02eb32b07153a7cf7be14141a6fd8baa0fc10c46a5f7c7c9e4397755137`）。Native／WASM変更なし。commit／push／公開なし。実ゲームでの実聴・体感速度確認はこの無音検証に含まない。
