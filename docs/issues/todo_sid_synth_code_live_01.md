# SID Synth：Code操作を既存UIへLive表示（2026-11-11）

ユーザー承認: Codeから変更した波形・Pulse width・ADSR・Filterを、原曲SIDと同じ「Your sound」で観察する。LiveはOn／Off可能で、Stop後は元の編集表示へ戻す。演奏用helper／Preset一括適用／Round robin機能追加、Looper／Event Recは含めない。

- [x] 既存song LiveとCodeの所有権・CH選択・編集音色保存の境界を整理し、Codeは観察のみで元presetを変更しない。
- [x] Codeの実Worklet状態を間引いて取得し、既存editor／readout／変更ハイライトへ接続する。古いRunやStop後の遅い応答は反映しない。
- [x] 同じ位置のLive On／Off、CH1〜3の観察切替、Code終了／Keyboard復帰／原曲再生時の表示復帰を整える。CHを観察するだけでCodeの演奏を止めない。
- [x] 元preset・Files保存の不変、UI操作、原曲Live、Apply／Stop／model／pagehide、6581／8580、型／Monacoと無音headless回帰を必要範囲で検証する。
- [x] 可読ソース付き配布ZIP、cache／README／TODO・検証記録を更新する。commit／push／npm公開は行わない。

音声出力は行わない。browser検証はheadlessで、アプリ起動前に全destinationをgain0へ接続する。通常browser／native app／OS音量は操作しない。

## 既定Codeの更新

- [x] ユーザー指定のSaw／Sync／Ring、`livePrepare("sid-motion")`、独立したmelody／modulation／filterループを、新規プロジェクトの`index.js`へ採用する。完全版としてLP＋BPの初期設定とCH3の消音を含める。
- [x] 既存の保存Codeを維持し、cache参照と必要な確認を更新する。

既定Code更新の確認：Code関連Nodeテスト19件成功。実際のstarterを音声接続のないSID transportで評価し、3ループ登録、0.25拍のメロディ、2秒の比率変調、4秒のCutoff（100→600→100）、LP＋BP／CH1 routing／CH3消音、新規index初期化と保存済みindex保持を確認。cache keyは`sid-starter=2`。この後続変更を含む配布ZIPは未作成（下記ZIPはLive表示実装時点）。

## 完了記録

- Code実行中は既存のチェックを「Live from Code」として使用（既定On）。同じYour soundの波形／Pulse width／ADSR／共有Filterを読み取り専用で表示し、CH1〜3は観察先だけを切り替える。
- Live Offは観察を止めて元の編集表示へ戻す。Codeは継続し、Stop／Keyboard復帰では保存済みのCH設定へ戻る。原曲のAuto設定とは独立。
- 最短50ms、同時1件のprivate `observeCode`要求。音源の再生成・clock進行・preset反映は行わず、Stop／Off／旧ownerの遅延応答を破棄する。8580のEnvelope未対応表示は維持。
- Node 222件成功。最終ZIPでChromium／WebKit各Code Live 7項目、Monaco 5項目、原曲SID 46項目成功。原曲Pause→Round robinで異なるCH設定の案内を保つ回帰も追加。1240px／390px表示と可読実装への移動を確認。
- 最終ZIP：`release/tetorica_sid_synth_sid-code-live-final-20261111_itch.zip`（330 files、3,428,260 bytes、SHA-256 `8b02815ec3d103992cf98dcfb5f6d15ed3c2314c2ac50c1b35045caa63fd267a`）。minify／bundleなし。内包ソース261入力は現行repoと一致。
- 詳細：[検証記録](sid_synth_code_live_verification_01.json)。無音検証のみで実聴は行っていない。commit／push／npm公開なし。
