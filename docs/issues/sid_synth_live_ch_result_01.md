# SID Synth: Voice選択で即反映／Live CH表示（2026-11-08）

後続変更: [共通のLive UIと「？」ヘルプ](sid_synth_shared_live_ui_result_01.md)で別の一覧表を廃止し、通常の操作部をそのまま追従させる構成にした。以下は最初のLive表示実装時点の記録。

Use Voiceボタンを削除した。**Capture voices → Voice 1／2／3** で選んだsnapshotがすぐ鍵盤用の楽器になる。適用前に試聴を閉じ、非対応Voiceや古い適用応答では現在の楽器を保持する。

## Live表示と編集

ユーザーが選んだ配置に従い、**Your sound** をLive表示／通常の編集で切り替える。

- **Live CH view while playing** は初期On。SIDのPlay中は指定CHの状態を表示し、チェックを外すと鍵盤用の楽器の編集へ戻る。曲の再生は続く。
- **CH 1／2／3** は観察対象を切り替える。直近の一貫した全CH読取から即座に表示し、その後も更新する。曲や編集中の楽器への書き込みは行わない。
- 波形の全flag（合成・未選択を含む）、周波数code／Hz、Pulse width、ADSR code、Gate／Sync／Ring／TEST、観測可能なEnvelope、変調source、共有Filter出力／Cutoff／Resonance／routing／volume等を表示する。変更値は色で示す。
- Presetへ変換できない実状態も理由付きで観察できる。8580の現在のEnvelopeは未提供のためUnavailableと表示する。
- Captureは固定した別のbatch。元曲・subtuneとCapture時刻を表示し、Voiceを選ぶと試聴が止まり、通常の編集へ戻る。Live表示の変化と保存したsnapshotを混同しない。

最大20回／秒、前回read完了後50ms以上の間隔で既存Workletを読む。Captureも同じengineのread列へ直列化し、遅い応答をintervalで積み上げない。速い中間書き込みは見逃す可能性があり、全register書き込み履歴や元の時変instrumentを復元したとは扱わない。

Stop・ファイル／model／subtune変更・取消・モード切替・disposeで古い応答を無効化する。新しい再生からの最初の読取までは前回のframeをLiveと表示せず、待機中／前回sourceと明示する。観察エラーはLiveだけを停止し、曲と楽器を保持する。

## 変更と検証

- [sid_import.js](../synth-sid/sid_import.js): 取得・適用と読取の所有権。[sid_import_panel.js](../synth-sid/sid_import_panel.js): 選択とLive control。
- [sid_live_view.js](../synth-sid/sid_live_view.js): passive decoder／永続DOM。[synth.js](../synth-sid/synth.js): Your soundの表示切替。Live更新から音声やPresetは変更しない。
- `npm run test:sid-synth`: **116／116成功**（controller 27、Live decoder／view 7と既存の音源・editor・配布test等）。
- Chromium／WebKit、新規24項目×source／ZIPと既存16項目×source／ZIP＝**160項目成功**。実Workletで変動する自作fixture、CH切替、追従Off、遅延reply後のStop、合成波形、8580 Envelope未提供、Voice即適用、既存演奏・編集・保存を確認した。
- 1180px／390px画面を確認し、横overflowと外部配信asset依存なし。browserは全物理出力gain 0で実行。ゲーム曲の実聴・長時間・実Safari／WKWebViewは未実施。
- DSP／WASM、SDK snapshot、既存校正は不変。対応source kitとlicenseを含む可読ZIPを維持し、Native compilerは起動していない。

記録: [source新規](sid_synth_live_ch_browser_01.json)／[ZIP新規](sid_synth_live_ch_zip_browser_01.json)／[source回帰](sid_synth_live_ch_regression_01.json)／[ZIP回帰](sid_synth_live_ch_zip_regression_01.json)／[変更範囲](sid_synth_live_ch_scope_01.json)／[配布](sid_synth_live_ch_package_01.json)。

## 再開

ローカル配布候補: `release/tetorica_sid_synth_20261108-live-ch_itch.zip`。作成したZIPは5本のWASMと対応する13／14／29／99入力のsource kitを同梱する。通常の `scripts/package_itch_sid_synth.sh` にも変更が含まれる。

```sh
npm run test:sid-synth
node scripts/check_sid_synth_import_browser.cjs --out build/validation/sid-live-recheck.json --screenshots build/validation/sid-live-recheck-images
sh scripts/package_itch_sid_synth.sh sid-live-next
```

配布version名は未使用のものを選ぶ。commit／push／公開は未実行。任意の実曲でCHを観察して実聴する確認が次の人向け作業。
