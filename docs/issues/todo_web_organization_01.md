# web/ と開発者向けREADMEの整理

2026-11-03。ユーザーがweb/の肥大化と、READMEから必要な情報へ辿りにくいことを指摘。

## 今回の優先事項

- [x] ルートの英日READMEを、docs/index.htmlに近い目的別の入口へ整理する。
- [x] **TetoricaのGoalを冒頭に残す。** 理解・学習用資料・ブラウザー組込・文化としての読み解きと再構築、という既存4目標を維持する。
- [x] 「これは何」「WASM／低レベルJSの入手と利用」「対応ゲーム機と形式」「SoundChip」「使用例」「再利用」「ライセンス」「参考リンク」の8点を案内する。
- [x] VGM等の形式への対応とゲームタイトルの完全再現を混同せず、チップごとの実装・制約の詳細へリンクする。
- [x] 長いSPC／APIの説明とライセンス・出典を詳細文書へ整理し、情報と必要な表示を失わないようにする。
- [x] web/README.mdを、編集元・生成先・公開API・Native接続・テストの地図にする。
- [x] 変更した文書のリンク、API例、案内先と現在のコードの整合性を確認する。

## 棚卸し（作業開始時点）

- web/全675ファイル、直下632ファイル。直下には276件の`.test.mjs`と1件の型テストがある。
- 直下のruntime JSは345件。主な群はplayground_108件、native_63件。Worklet・AudioEngine・Synth・VGM解析・codecが混在する。
- web/は再利用runtimeの編集元。`docs/js/`には生成・同期された公開用コピーと、一部の独立実装がある。配布用コピー時には相対URLの書き換えも行う。
- npmは平坦な直接importを提供し、Tauriにも固定のweb/パスがある。移動に先立って、編集元と配布先の関係を明示する。

## 次の実装候補（今回は未着手）

1. テスト277件を`test/web/`へ移し、`test:web`を追加する。現在の直下632件を355件まで減らせる。
2. `test:analyzer`、`test:cdrom2`、CI、`scripts/test_vgm_mock.sh`、型テスト参照を更新する。既存の`npm test`は入れ子のテストを自動で拾わないため、実行対象を明示する。
3. 静的／動的import、`readFile(new URL(...))`、Worker URL、eval内のimportを確認する。134件が`import.meta.url`、22件がWorkerを使用するため、単なるパス置換で済ませない。
4. SDK校正の入力にもなる`spc_test_fixture.mjs`、共有の`native_genesis_extra_creation_fixture.mjs`は最初の移動では残す。過去の測定報告のhash・記録を一括置換しない。
5. runtimeの物理移動は、同期・配布manifestの整理後に一群ずつ検討する。公開importパスとWorker／WorkletのURLを維持する移行方法を先に決める。

ファイル移動や公開APIの変更は、このREADME整理と分けて進める。

## 今回の整理

- ルート英日READMEはGoalの4項目を先頭の紹介直後に保持し、用途別の入口、ブラウザーツール、機種／形式とチップの対応、WASM入手、低レベルの使用例、再利用、ライセンス、構成と参考リンクを掲載する。
- SPCなどの詳細操作は`docs/browser_workflows.md`と日本語版へ、既存のライセンス／クレジットと実装参考資料は`docs/attribution.md`と日本語版へ整理する。
- `web/README.md`にはAPI層別の代表ファイル、共有ソースと公開コピーの関係、WASM／npmの生成手順、テストへの入口を記載する。
- README／詳細文書7件のローカル相対リンク184件、fragment18件が解決することを確認した。web/READMEの低レベル例は、実WASMをNodeで読み込み、有限のステレオPCM128フレームを生成・disposeできることを確認した。
- ルートREADMEの例も実WASMで実行し、53,267 Hz／4,096フレーム、peak約0.02499の有限なステレオPCMと16,428-byte WAVを生成できた。例のnpm importはローカル編集元に置き換えて検証した。
- Gitの作業開始時点と比べ、英日Goalの4項目は完全一致する。移した既存クレジット／参考リンク全文は相対URLの補正以外で一致し、既存の英語SPC詳細も保持した。既存のREADME章anchorへの入口も残した。`git diff --check`成功。
