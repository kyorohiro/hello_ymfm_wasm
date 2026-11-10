# SIDの共通JavaScript生成API（2026-11-11）

ユーザー依頼: YM2612と同程度の公開範囲で、npmルートの共通`createSoundChip()`へSIDを追加する。型・補完も同程度に揃える。Preset／3CH設定の一括適用、Round robin、Legatoなど演奏向けhelperは追加しない。Looper／Event Recも保留のまま。

- [x] 既存YM2612のdirect／AudioWorklet生成・低レベルAPI・型とSID coreの契約を比較し、同等の共通入口を決める。
- [x] `createSoundChip('sid')`へ6581／8580 Previewの選択・WASM asset解決・取消・独立instance・破棄を接続する。既存SID音源のDSP／校正値は変えない。
- [x] YM2612と同じ公開方針で型・補完を整合させ、SIDのPlayground／Code／npmの同期・非同期差を正しく記述する。
- [x] 共通factoryのdirect／Worklet、既存YM2612回帰、公開型、生成したnpm配布物と改造用sourceを検証する。音を出さず、browserはheadlessと事前gain0を使う。
- [x] README／対応表／TODOと検証記録を更新する。npm公開・version更新・commit／pushは今回行わない。

範囲: 音源chipの生成・register操作・PCM生成と、その公開契約。`.sid`曲再生やSynth固有の演奏操作は一般APIへ持ち込まない。

## 完了記録

- 共通factoryにSIDを追加。directは既存`SidCore`／`Sid8580Core`を返し、`new SidSynth({core})`でも利用可能。Workletは既存generic endpointを使う。model／clock／rate／WASM配置・注入、取消、独立ID、明示的な開始・停止・破棄を検証した。
- 元coreとPCMが完全一致し、Workletも左右へ同一mono PCMを出す。元DSP／WASM／固定SDK／既存校正値を変更していない。
- YM2612には専用`getRegisterSnapshot`／phase観察APIがないため、SIDのPlayground／Code公開型にも今回追加しない。共通生成の型は追加し、NodeNext／Bundler／Node ambientなしbrowserの正負型テストを成功。
- 公開factoryを測定するPSG校正のsourceが変わるため、旧04を保存したまま05で再測定。18件の数値・reference・gainが旧04と完全一致し、生成済みMixer値は不変。
- Node33件、インストール済みnpm配布チェック（1251files・410宣言）、Chromium／WebKitのnpm配置／docs/js配置、実レジスター・PCM・Mixer・Stop／Resume・port・所有context・YM2612回帰が成功。全destinationを起動前gain0、実聴なし。
- ソース・README en／ja／AI・配布ガイドを更新。`dist/fm2612`は次回公開用にbuild済み。versionは0.2.38のまま、既存の公開済みtarballはSHA256を含めて不変。npm公開／commit／pushはしていない。

恒久記録: [sid_common_factory_verification_01.json](sid_common_factory_verification_01.json)。
