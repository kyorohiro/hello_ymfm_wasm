# VAB共通APIのnpm公開（2026-11-12）

VAB共通APIの実装完了後の「進めて」に沿い、`tetorica-fm2612`の次のパッチ版を公開する。開始時のregistry latestは0.2.39、0.2.40は未使用。

- [x] registryのlatest・次のversionと作業treeを確認する。
- [x] package version・READMEの配布例・release notesを0.2.40へ揃える。
- [x] 可読JS・型・固定WASM・source kitを含むtarballをbuildし、実際のtarballを独立installして既存package検証・VAB実SPU・NodeNext／Bundler／browser型を確認する。
- [x] 旧tarballとの比較で見つかった、cache query付きimportに由来するSPU内部状態の型推論低下を、配布JSを変更しない型生成処理で修正・確認する。
- [x] 検証済みtarballのhashを固定し、必要なnpm認証をユーザーへ依頼する。
- [x] 同じtarballをnpmへ公開し、registryのversion／latest・SHA1／SHA512 integrity・tarball全byte一致を確認する。
- [x] 公開記録と関連README／TODOの公開状態を更新する。

認証開始時の`npm whoami`は401（認証切れ）。認証URL・token・OTPを検証記録へ保存しない。音声は出力せず、通常browser／native app／OS音量は操作しない。既存の音声・browser検証は[実装検証記録](ps1_vab_public_api_verification_01.json)を引き継ぎ、今回は同じJS/WASMのversion付きtarballを再検証する。git commit／push／tag、itch公開、Tauri更新、別examples repository更新は今回行わない。

## 最終候補の準備

0.2.40のbuildは360 modules／28 WASM engines／411 strict declarationsで成功。公開済み0.2.39との比較では、新VAB API以外の音声処理の変更は、一発再生ADPCMのLOOP START marker受入れだけ。noteOff／Releaseや全WASMは0.2.39と同一。

型生成はcache query付きimportを型推論時だけ正規化して、終了時に配布JSを必ず元byteへ戻す。SPU client内部state・Worklet synth／validationの型がanyへ弱まる問題を修正し、3profileのno-any assertionを追加。最初の候補との比較でruntime／WASM／source kit 812ファイルのbyte不変を確認した。

検証済み候補: `build/npm-vab-release-20261112/tetorica-fm2612-0.2.40.tgz`（2,821,471 bytes／1,253 files）。SHA256 `37ec63230722361b2a9ac0e35c73e7d4289d7f57343c31b7a051296c9b5ca60c`。独立installの実SPU・全28 WASM／15 renderers・1,172 local references・NodeNext／Bundler／Node型なしbrowser profileが成功。ログ: `/private/tmp/npm-vab-release-final-installed.log`。

ログイン済み。公開追加認証は完了し、公開コマンドはHTTP 202・exit 0（+ tetorica-fm2612@0.2.40）で受理。公開registryのlatestが0.2.40となり、配布物の再取得・全byte照合まで完了。認証URLはこの記録へ保存しない。

## 公開完了

`tetorica-fm2612@0.2.40`を公開済み（2026-11-12 16:29 JST）。[npm package](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.40)。registryのlatestとversionを確認し、公開tarballを再取得して検証済み候補との全byte一致、SHA1／SHA512 integrity一致を確認した。公開受理からregistry反映まで約5分待ち、再公開は行っていない。

配布物: `build/npm-vab-release-20261112/registry/tetorica-fm2612-0.2.40.tgz`。registry照合: `build/npm-vab-release-20261112/registry-verification.json`。恒久記録: [npm_ps1_vab_release_01.json](npm_ps1_vab_release_01.json)。元の実装検証・0.2.39公開記録は当時の証跡として保持し、SPU Synth READMEと元VAB TODOへ公開済み状態を追記した。commit／push／tag、別examples repository・Tauri・itch公開は行っていない。
