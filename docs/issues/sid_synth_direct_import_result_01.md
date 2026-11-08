# SID SynthのSID直接読み込み（2026-11-08）

後続変更: [Voice選択で即反映／Live CH表示](sid_synth_live_ch_result_01.md)でUse Voiceボタンを廃止し、Your soundの再生CH追従表示を追加した。以下は最初の直接読み込み実装時点の記録。

Synth上部の折りたためる **Sounds from SID** から、SID曲を試聴し、その瞬間の音色を同じ鍵盤へ取り込めるようにした。

## 使い方

1. **Load SID…** でローカルの `.sid` を開く。現在の楽器は保持し、音声は開始しない。
2. 必要ならSubtune／modelを選び、**Play song** を押す。
3. 欲しい音が鳴っているときに **Capture voices** を押す。
4. **Voice 1／2／3** から候補を選び、**Use Voice** を押す。
5. 曲の試聴が停止し、その音を鍵盤で演奏・編集・Preset保存・Copy JavaScriptできる。

Captureは一回のWorklet読取によるregister設定のsnapshot。曲内の時間変化を復元する機能ではなく、鍵盤で音程とGate／ADSRを開始し直す。独立したSync／Ring pairは周波数比を保持する。合成波形・TEST・変調chain等は既存変換器と同じ理由を表示する。Presetに曲／ROM／PCMを含めない。

PAL・single SID・PSID／RSID v2と既存C64内蔵環境を使用する。Autoは既知の6581／8580宣言に従い、不明／eitherではPAL／6581を使う。既知のmodel不一致やNTSCは元headerを書き換えず診断を出す。Direct VBIやユーザーROMの選択は別のSID Playerから行う。

## 実装と確認

- [controller](../synth-sid/sid_import.js) が既存Playerの検証・model・C64音源・snapshot変換を再利用する。[panel](../synth-sid/sid_import_panel.js) はDOM表示、[synth.js](../synth-sid/synth.js) は音声とmonitorの所有権を担当する。
- ファイル取消・不正候補・古いread／capture／起動応答は、確定済みの楽器・ファイル・snapshotを保持する。採用が成功するまで旧試聴を保持し、Useの終了待ち中に編集された楽器を古い応答で上書きしない。
- 曲のPlayはSynth音を停止し、鍵盤演奏は試聴の停止完了後に発音する。Masterは両経路へ反映、Stop all soundは両方を停止する。monitorは実際の出力経路を追従する。
- `npm run test:sid-synth`: **100／100成功**。controllerの実WASMによる6581／8580・VBI／CIA／RSIDと、所有権・競合・保存復元を含む。
- Chromium／WebKitのsource／独立ZIP: 新規18項目×4＋既存16項目×4＝**136項目成功**。390pxとdesktop表示、外部配信asset不要、試聴と鍵盤の切替、取消・不正入力・起動中Stop等を確認した。
- browserは自作fixtureを用い、物理出力をgain 0にして検証した。実ゲームSIDの実聴・長時間・実Safari／WKWebViewの確認は別作業。
- 元DSP／WASM、固定SDK、既存校正は変更していない。runtime inventoryと両mixer freshness検査も成功した。

記録:

- [source新規browser](sid_synth_direct_import_browser_01.json)／[ZIP新規browser](sid_synth_direct_import_zip_browser_01.json)
- [source既存回帰](sid_synth_direct_import_regression_01.json)／[ZIP既存回帰](sid_synth_direct_import_zip_regression_01.json)
- [変更範囲・固定入力](sid_synth_direct_import_scope_01.json)／[実ZIP・対応source検証](sid_synth_direct_import_package_01.json)

## 配布と再開

ローカル配布候補は `release/tetorica_sid_synth_20261108-sid-import_itch.zip`。可読JS／CSS、5本のWASM、対応する13／14／29／99入力のNative source kit、licenseとrebuild手順を同梱する。packagerは既存生成物を検査して使い、この作業ではcompilerを起動していない。実ZIPのfile hash・source対応は上記package記録に保存する。

今回追加したbrowser検査はGitHub Actionsにも接続済み。再検証例:

```sh
npm run test:sid-synth
node scripts/check_sid_synth_import_browser.cjs --out build/validation/sid-import-recheck.json --screenshots build/validation/sid-import-recheck-images
```

新しい配布候補は未使用のversion名を付けて作る（既存ZIPを上書きしない）:

```sh
sh scripts/package_itch_sid_synth.sh sid-import-next
```

commit／push／itch公開は未実行。Tauriへの取り込みと、人による任意SIDの実聴が次の確認対象。
