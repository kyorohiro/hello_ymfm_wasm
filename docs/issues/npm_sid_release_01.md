# tetorica-fm2612 SID npm配布 TODO（2026-11-09）

ユーザー承認: SID 6581／8580のJavaScript APIとWASMをtetorica-fm2612のnpm配布へ揃え、型・利用例・独立package検証を仕上げてnpm更新へ進む。公開済み0.2.36の実tarballにはSIDがないことを確認済み。

- [x] 現在の公開入口／型／flat・nested runtime配置／WASMとsource kitの依存を確認する。
- [x] 両modelのWASM・receipt・可読source・license／toolchain noticesを同梱する。flat npmのmodule-relative URLを修正し、既存nested配布を維持する。
- [x] SidCore／Sid8580Core／SidSynth・Playgroundの型と利用例、package README／asset一覧／metadataを整える。既存generic factoryと独立instrumentの入口を区別する。
- [x] 実際のnpm tarballを独立installして、両modelのPCM／型／既定URL、ブラウザーのAudioWorklet・Main／Worker経路、欠損asset・source／notice漏れを検証する。
- [x] 必要な回帰検証と配布検証を通し、次versionの公開物を準備する。npm認証が必要なら検証済みの公開操作に進んだ時点で案内する。
- [x] npmへ公開し、registryの公開version／配布内容を確認する。

境界: CPU-free SID音源を配布する。PSID／RSID playerの公開API新設、generic chip factory全体の設計変更、固定Native SDK snapshotの更新は混ぜない。既存のWeb音源／校正／可読ソースを維持する。

開始時点の親repositoryはclean。Native SDK統合は別repositoryの作業であり、npmの既存SDK pinを自動で置き換えない。

## 検証済み配布候補

- 0.2.37、1,245 files、2,792,889 bytes。検証したtarballを`build/npm-sid-release-20261109/`へ保持した。
- SHA256: `5cf99358e57d9662663924e08bf9d1f31e50b76782f3e89c5fa7ab347fb6f216`
- SID関連54 tests、配布配置5 testsが成功。407型宣言を生成・検証し、独立install後のNodeNext／Bundler／Node ambientなしBrowser型も成功した。
- Node 22.22.0で独立install後の全体検証が成功。1,150 local module／asset参照、15 renderers、28 WASM engines、PS1／SCSPほか既存Sample／Native helperの検証も成功した。
- Chromium／WebKitのSID 12経路が成功。両modelの直接PCM、Main／Worker、既定WASM URL、実際の音声変動、適用済みInspector、Stop／finalizeを確認した。物理音声出力はmuteし、実聴とは区別した。
- 同一tarballの既存DX7／HuC6280も両browser・Main／Workerで成功した。Node 22のtarballとSID browserのtarballはSHA256が一致する。
- npmに除外される原本metadata2ファイルは別名でbyte完全保持し、付属`restore-npm-sources.mjs`で復元する。127 source／notice files、元の99 build inputsのhash、復元の冪等性を検証した。
- 正本の音源・制御JS／WASM／固定SDK pinは変更していない。flat配布のasset URL・source同梱・型・案内・検証を変更した。npm公開と公開物の照合も完了した。

## 後続（今回の公開対象外）

- [ ] Playgroundのprimary SIDを8580へ拡張するなら、Worker primary portsへmodelを渡す設計と初期化失敗の扱いも確認する。今回は既存契約どおりprimary6581、8580は専用Core／独立instanceで提供する。
- [ ] 差分をcommit／pushし、新設したnpm package CIのremote結果を確認する。

## 公開完了

`tetorica-fm2612@0.2.37`を公開した。registryのversion／latestがどちらも0.2.37になり、公開tarballを再取得して検証済みtarballとの全byte一致、SHA1／SHA512 integrityを確認した。

- 公開URL: https://www.npmjs.com/package/tetorica-fm2612/v/0.2.37
- SHA1: `01e8d9bc83c5be0e2c4870a0909e08b2ce6b0359`
- 確認時刻（UTC）: `2026-11-08T22:38:15.732134+00:00`
- 記録: [npm_sid_release_01.json](npm_sid_release_01.json)。公開tarballとregistry照合記録は`build/npm-sid-release-20261109/registry/`／`registry-verification.json`へ保存した。

npm CLI 11.20は最初のHTTP 202でも成功表示を返したが、versionは一時的にstagedだった。再送は同一versionの409を返したため上書きせず、認証付きversion statusの`published`と公開registry反映を確認した。今後もCLIの成功表示だけで公開完了とは扱わない。アカウント認証や公開認証のURL／tokenは検証記録へ保存していない。
