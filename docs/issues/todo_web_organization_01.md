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

## 生成物の統一（2026-11-03実装）

ユーザーの追加指摘「web/generatedを見ても全部揃わない」を受け、先に生成物の基準を決める。2026-11-03、ユーザーの「進めて」を受け、下記の生成物統一を実装した。テスト／runtime本体の移動は後続段階。

### 先に生成物を一本化する

- [x] 全WASM／loader／付随metadata・ライセンスの入出力を一つのmanifestで管理する。SDK catalogを参照し、DX7とNative FXの対応付けも明示する。既存の一覧・パス判定をこれに集約する。
- [x] `web/generated/`を、共有runtimeが使う生成物が全部揃う正本にする。`docs/generated/`はWeb公開用のコピーとして同期する。
- [x] チップbuild scriptの既定出力先を揃える。配布・検証でも同じmanifestを使い、不足・古いコピー・loader／WASMの不一致を検出する。
- [x] DX7のvendor layoutとNative FXの既存URLを、manifestで管理する同期先として扱う。公開URL・npmのimport・既存のTauri参照パス・測定入力の内容を維持して移行する。

移行前の調査結果：

| 場所 | 内容 |
| --- | --- |
| `web/generated/` | 7組14ファイル。cdda、msm5205、nesapu、pwm32x、gameboy_apu、segapcm、k051649。同名のdocs側と全てバイト一致。 |
| `docs/generated/` | 67ファイル。32組のloader＋WASM、DX7の`msfa.wasm`、metadata 2件。 |
| `web/msfa_dx7/wasm/`、`docs/js/msfa_dx7/wasm/` | DX7のvendorパッケージ内コピー。 |
| `docs/native_audio_effect/gain.wasm`、`web/native_audio_effect.wasm`、`docs/js/native_audio_effect.wasm` | Native FXのbuild出力とruntime／公開コピー。 |

移行前は通常のチップbuildが`docs/generated/`、CD-DA／MSM5205が`web/generated/`へ出力していた。一部のwrapperには`/web/`というURLから参照先を切り替える処理があり、同期・npm配布時にも個別の書換がある。今回、生成物の入出力を共通化した。runtime JSのURL解決処理と固定SDK snapshotは変更していない。

実装と検証：

- `scripts/runtime_artifacts.mjs`で固定SDK catalogから33件のビルドを取得し、Native FX・metadata・同期先を追加。`web/generated/runtime-artifacts.json`には66出力のhash／size、source／license参照、公開先を記録し、docs側にも同じmanifestを配置する。
- 32組のloader＋WASM、DX7の`msfa.wasm`、Native FXの`effects/gain.wasm`を正本へ集約。既存のSDKビルド記録・200件のsource入力・PS1補助記録・FX ABIと既存コピーの一致を検証してから移行し、DSPは再コンパイルしていない。
- `npm run check:runtime-artifacts`は書き込みなしで検証する。`npm run sync:runtime-artifacts`は正本を検証して公開コピーを更新する。初期移行用の`--import-existing`以外ではdocs側へのfallbackを行わない。
- 全33件のSDK wrapperとNative FXの既定出力・同期を統一。明示的な出力先は公開コピーを更新しない。SCSPは呼出元の相対出力先を絶対化し、SDK内へ誤生成する既存不具合も修正した。
- 共通profileからPlayground／Analyzer／FM Synth／npmの生成物を配置。SPU／SCSPの個別Synth ZIPとsource bundleも正本を参照する。公開コピーが古い場合は、配布前に停止する。
- 新規のartifact／builder／profileテスト26件、既存SDK inventoryテスト72件、関連統合テスト52件、固定SDKのrecording compilerを使うPython検証118件が成功。追加したSCSP 2件は呼出元からの相対パスも検証する。Python検証は実WASMの全件再ビルドを意味しない。
- Playground／Analyzer／FM Synthの`artifact-check` ZIPを実生成し、CRC／入口を検証。Playground Run ZIPは968ファイル／968 entriesで1000件以内。SPU／SCSPの個別ZIPテスト4件でもcanonicalとのバイト一致、source receipt、リンク、SCSPの再現性を確認した。
- `npm run build:fm2612`、インストール済みtarballの実WASM・PCM・source／license検査、NodeNext／Bundler／Browser型検査が成功。VGMのbuildは192依存ファイルを配置し、ローカルtarballのSPC／VGM／S98解析・各種export・CLI smokeも成功した。
- 作業前の公開JS／WASM等474ファイルは全てバイト一致。既存の校正チェックも成功した。共通syncの再実行は変更0件、最終checkは33 SDK builds／66 outputs／73 mirrorsを確認。Tauri本体の再ビルドや実機UI確認は今回行っていない。
- README／build／release案内を正本と共通コマンドに更新し、ローカルリンク163件と正本からのYM2612低レベル例（有限なstereo PCM 128フレーム）を確認。Goalの4項目は変更していない。

追加CLI検証で見つかった既存課題（今回の生成物整理とは別）：

- [ ] `scripts/check_pokey_vgm_package.mjs:182`と後続assertの固定gain=1を、現行の測定済み既定値0.413052を扱う検証へ更新する。公開／正本のpresetは既存と一致し、今回変更していない。追加チェックはこの古い期待値で失敗した。
- [ ] `scripts/check_wonderswan_vgm_package.mjs`の長いvoice capture検証がexit 137で終了する原因を切り分ける。単独実行でも同じ終了で、JavaScript assertionは出ていない。通常のVGM package smokeは成功したが、この追加チェックは完了していない。

### 次にテストとソースを整理する

2026-11-03の追加指摘を受け、ルート全体の[フォルダー配置案と移行TODO](todo_repository_organization_01.md)を作成した。教材の統合と独自例の`tetorica_examples/`分離、テストの`test/runtime/`移動まで実装済み。ユーザーの追加指定によりymfm由来の`src/`・`examples/`は維持し、独自実装の移動先は`tetorica_src/runtime/`とする。

1. 完了：テスト277件を`test/runtime/`へ移し、`test:runtime`を追加。直下632件を355件へ削減した。
2. 完了：`test:analyzer`、`test:cdrom2`、CI、mock runner、型テストの参照を更新。`npm test`も入れ子のruntimeテストを明示的に実行する。
3. 完了：静的／動的importとURL基準を移行し、全277件の逆変換比較と移動前後の3,728件の実行結果一致を確認した。
4. 維持：`spc_test_fixture.mjs`と`native_genesis_extra_creation_fixture.mjs`は共有・SDK校正の入力として元の場所に残した。過去の測定報告は変更していない。
5. 完了（2026-11-04）：runtimeとNode／CLI／Native／WASMを`tetorica_src/`へ移した。正本は`tetorica_src/runtime/generated/`。公開importパスとWorker／WorkletのURLを配布境界の変換で維持し、npm実インストールとitch ZIPを検証した。詳細は[第3段階の記録](todo_repository_organization_01.md)を参照。

共有実装は`tetorica_src/runtime/`へ移設済み。今後の内部配置候補：`chips/<chip>/`にchip固有のwrapper／Synth／Worklet、`audio/`に共通音声処理、`playground/`に共有実行runtime、`native/`にNative接続、`formats/`にファイル形式・codecをまとめる。公開npmの平坦なimportパスは配布時に維持し、編集時の構成と公開時の構成を分ける。

移設に公開APIの変更は含めていない。上記のチップ別／機能別の内部再分割は、次回以降のTODOとして残す。

## 今回の整理

- ルート英日READMEはGoalの4項目を先頭の紹介直後に保持し、用途別の入口、ブラウザーツール、機種／形式とチップの対応、WASM入手、低レベルの使用例、再利用、ライセンス、構成と参考リンクを掲載する。
- SPCなどの詳細操作は`docs/browser_workflows.md`と日本語版へ、既存のライセンス／クレジットと実装参考資料は`docs/attribution.md`と日本語版へ整理する。
- `web/README.md`にはAPI層別の代表ファイル、共有ソースと公開コピーの関係、WASM／npmの生成手順、テストへの入口を記載する。
- README／詳細文書7件のローカル相対リンク184件、fragment18件が解決することを確認した。web/READMEの低レベル例は、実WASMをNodeで読み込み、有限のステレオPCM128フレームを生成・disposeできることを確認した。
- ルートREADMEの例も実WASMで実行し、53,267 Hz／4,096フレーム、peak約0.02499の有限なステレオPCMと16,428-byte WAVを生成できた。例のnpm importはローカル編集元に置き換えて検証した。
- Gitの作業開始時点と比べ、英日Goalの4項目は完全一致する。移した既存クレジット／参考リンク全文は相対URLの補正以外で一致し、既存の英語SPC詳細も保持した。既存のREADME章anchorへの入口も残した。`git diff --check`成功。
