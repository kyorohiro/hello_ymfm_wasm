# SID Synth: Live／編集の共通UIと「？」ヘルプ（2026-11-08）

後続変更: [Pause／Resume](sid_synth_pause_result_01.md)で試聴の一時停止と、保持した状態のCH確認／Captureを追加した。

ユーザー指摘に従い、Liveの別一覧表を廃止した。**Your sound** はLiveでも編集でも、同じ波形ボタン・Pulse width・ADSR・Filter・Sync／Ring／TEST・ratio操作部を同じ場所で使う。

## 表示と操作

- Live中は同じ操作部へ現在CHの値を読み取り専用で表示し、変化を色で示す。初回読取待ちの間も書き込みを許可しない。
- LiveをOffにすると、そのままの要素と折りたたみ状態で作成中の楽器へ戻る。観察状態はPresetや音声へ書き込まず、Live中の外部Preset更新も元の編集データとして保持する。
- 合成波形は同じ波形ボタンを複数点灯、未選択では全て非点灯。共有Filterの出力bitはdryのCHでも実値を表示し、filterへroutingされた全出力Offをbypassへ変換しない。
- 実際のratioが鍵盤用の範囲外でも数値を丸めず表示する。周波数0で比を定義できない場合は「—」とし、無効なslider thumbを隠して配置を保持する。
- 周波数・Gate・現在Envelope・source・Capture可否・再生位置等の補助readoutは操作部の下にまとめた。8580の現在EnvelopeはUnavailableのまま。
- 長い説明は各カードの **?** ボタンで開く。初期状態は閉じ、pollやLive／編集切替で開閉しない。閉じたカードの?はカードも開いて説明を見せる。説明を閉じてもカードは閉じない。
- Sounds from SIDとLive切替の説明、sample表示の注意も?の中へ移した。読み込み結果・エラー等の状態表示は残す。

主な変更: [editor.js](../synth-sid/editor.js) の `observe(decoded, {active})` が同じDOMへ観察値を重ね、`observe(null)` で編集へ戻す。[sid_live_view.js](../synth-sid/sid_live_view.js) はraw decoderと簡潔な補助表示を担当する。[synth.js](../synth-sid/synth.js) はeditorを隠さず、各状態を渡す。

## 確認

- `npm run test:sid-synth`: **122／122成功**（editor 30件、decoder／補助view 8件、既存controller／音源／配布等）。
- Chromium／WebKit、source／独立ZIP: 新規28項目×4＋既存16項目×4＝**176項目成功**。同じDOM要素であること、操作部の相対位置、Live readonly、合成波形・変動値、元の楽器への復帰、?とカードの開閉・focus、既存の演奏／編集／保存を検証した。
- 1180px／390pxの画面を確認。外部asset依存・横overflowなし。browserは自作SID fixtureのみで物理出力gain 0を使用し、実ゲーム曲の実聴や長時間テストは行っていない。
- DSP／WASM、固定SDK、校正は不変。Native compilerを起動せず、既存5本のWASMと対応するsource kit／licenseを可読ZIPへ同梱する。

記録: [source新規](sid_synth_shared_live_ui_browser_01.json)／[ZIP新規](sid_synth_shared_live_ui_zip_browser_01.json)／[source回帰](sid_synth_shared_live_ui_regression_01.json)／[ZIP回帰](sid_synth_shared_live_ui_zip_regression_01.json)／[変更範囲](sid_synth_shared_live_ui_scope_01.json)／[配布検証](sid_synth_shared_live_ui_package_01.json)。

配布候補は `release/tetorica_sid_synth_20261108-shared-live-ui_itch.zip`。通常のpackagerでもこのUIが含まれる。

```sh
npm run test:sid-synth
node scripts/check_sid_synth_import_browser.cjs --out build/validation/sid-shared-ui-recheck.json --screenshots build/validation/sid-shared-ui-recheck-images
sh scripts/package_itch_sid_synth.sh sid-shared-ui-next
```

version名は未使用のものを選ぶ。commit／push／公開は未実行。実曲の実聴、実Safari／WKWebViewとTauri配布への取り込みは後続。
