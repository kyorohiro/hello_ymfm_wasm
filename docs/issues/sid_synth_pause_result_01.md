# SID Synth: Pause／Resume（2026-11-08）

後続修正: 実画面で旧audio module混在によるPause拒否を確認し、[transport更新不整合](sid_synth_transport_upgrade_result_01.md)へ対応した。最初の新規contextだけの検証に加え、旧module残存のケースを追加している。

SID試聴へ **Pause／Resume** を追加した。変化の速い音色を止め、同じYour soundの操作部でCHの設定を確認してCaptureできる。

## 操作と保持する状態

1. **Play song** で試聴する。
2. **Pause** を押す。ボタンがResumeへ変わり、Pause完了時点のCPU／SIDと再生位置を保持する。
3. **CH 1／2／3** を切り替えて確認する。LiveをOffにすると作成中の楽器を編集でき、Onで停止中のCH表示へ戻る。
4. 必要なら **Capture voices** を押す。読み取る状態は停止中のものと一致する。
5. **Resume** で同じinstanceの続きから再生する。Capture後も再開できる。捕捉したVoiceを選ぶ場合は試聴を閉じて、その設定を鍵盤へ取り込む。

一時停止中に定期pollは行わず、CH切替はPause ACKに含まれる全CHの状態を使う。Captureは所有している同じWorkletへreadする。初期化／再load／core.stopを呼ばず、停止中は音源をrenderしない。

Pause ACKはaudio処理境界の状態。直前の表示pollの値を停止点として流用しない。Resumeは元の操作gestureでAudioContextを復帰させ、同じcoreへresumeを送る。新しいcontextやloadは発生しない。

境界の段差を和らげるため、Pause／Resumeに限って5msのhost出力bridgeを使用する。Pause後は最後の出力sampleから0へ、Resume時は続きのPCMへ接続する。この間も停止中のchip／CPU／Envelope／filterは進行しない。初回Playと通常再生PCM、Native DSP／WASM／固定SDKは不変。実聴でクリックが完全に消えたと判定したものではない。

Stop、鍵盤発音、dispose、受理したfile／model／subtune置換はpaused／遷移中のpreviewも終了させる。古いPause／Resume ACKは復活させない。取消・不正候補では確定済みのpaused sessionを保ち、Master変更だけで再生を再開しない。

## 実装と確認

- [Player processor](../sid-player/processor.js)／[audio](../sid-player/audio.js): `pause`／`resume`とhost出力bridge。通常SID Player画面のUIは変更していない。
- [sid_import.js](../synth-sid/sid_import.js): transport所有権とpaused Capture。[panel](../synth-sid/sid_import_panel.js)／[synth](../synth-sid/synth.js)／[view](../synth-sid/sid_live_view.js): ボタンと保持した共通UI。
- `npm run test:sid-synth`: **135／135成功**。controller38件、鍵盤への切替・paused表示等を含む。
- `npm run test:sid-player`: **136／136成功**。実6581／8580それぞれVBI／CIA／RSIDの6machineで、Pause中32出力blockを処理しても公開core stateが不変。Resume後、5ms bridge以降は対照coreの続きのPCMと一致し、処理後のcore stateも一致した。初回通常PCM、Stop／reload／dispose、失敗・起動待ち競合も検証した。
- 新規のSynth browser38項目×2engine×source／ZIP＝**152項目**、既存Synth回帰16×2×source／ZIP＝**64項目**、通常SID Player回帰35×2＝**70項目**、合計 **286項目成功**。
- 実WorkletのPause ACK／停止中read／Capture／表示値、同じnode/context/load数、CH・Live切替、Master無音、取消／不正候補、遅延ACKとStop、鍵盤への切替を確認。1180px／390px表示、完全local asset、?ヘルプと共通editorも維持した。
- browserは自作fixtureで物理出力gain 0。実ゲーム曲の実聴・長時間・実Safari／WKWebViewは未実施。CIへ関連Player audio／processor testを追加し、YAML構文とdiff checkが成功した。

記録: [source新規](sid_synth_pause_browser_01.json)／[ZIP新規](sid_synth_pause_zip_browser_01.json)／[source回帰](sid_synth_pause_regression_01.json)／[ZIP回帰](sid_synth_pause_zip_regression_01.json)／[通常Player回帰](sid_synth_pause_player_regression_01.json)／[変更範囲](sid_synth_pause_scope_01.json)／[配布検証](sid_synth_pause_package_01.json)。

## 配布と再開

配布候補は `release/tetorica_sid_synth_20261108-pause_itch.zip`。可読34module、5本のWASM、13／14／29／99入力の対応Native source kitとlicenseを同梱する。ブラウザーのtransport出力処理は更新したが、Native compilerやDSP buildは実行していない。

```sh
npm run test:sid-synth
npm run test:sid-player
node scripts/check_sid_synth_import_browser.cjs --out build/validation/sid-pause-recheck.json --screenshots build/validation/sid-pause-recheck-images
sh scripts/package_itch_sid_synth.sh sid-pause-next
```

配布version名は未使用のものを選ぶ。commit／push／公開は未実行。人によるPause／Resume境界の実聴・任意SIDでの確認を経て、Web公開とTauri化が次の候補。
