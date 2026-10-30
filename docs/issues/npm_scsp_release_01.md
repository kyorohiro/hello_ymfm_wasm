# tetorica-fm2612 0.2.35 release — 2026-10-30

ユーザー指示でSCSP対応を含むnpm公開を準備。
**公開済み：`tetorica-fm2612@0.2.35`、npm latestも0.2.35。**
[公開パッケージ](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.35)。

README冒頭と同梱 `sources/README.md` に、C/C++音源コアとWASM build recipeの提供元として
[tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native)を追加。
upstreamの個別credit／licenseと、hash固定の未公開SDK 0.1.7 candidateの出自を維持する。
SCSP raw／Synth／PCM選択API、Main／Worker、対応Tauri Native transportをrelease notesへ記載。
LFO／slot FM／DSP高レベルAPI、SSF、Tauri binary、専用Synthページはnpmの対応範囲と混同しない。

`node scripts/check_fm2612_package.mjs` 成功。tarballの隔離install、SCSP PCM変換と実WASM、
従来音源、28 WASM engines／15 renderers、NodeNext／Bundlerの正負型、Node ambientなしのbrowser型を検証。
公開用 `tetorica-fm2612-0.2.35.tgz` の全1,051 filesが検証済みstageとbyte一致。
README2箇所のリンク同梱も検証。[artifact hash／SDK pin](npm_scsp_release_01.json)。

registry latestは0.2.34、0.2.35は未使用（E404）。npm whoamiはE401で既存認証が失効しており、
web loginは完了。検証済みtarballをpublish送信し、追加Web認証も完了し、publishはexit 0と `+ tetorica-fm2612@0.2.35` を返した。npm側の処理待ち後、registryのversion／latestが0.2.35になったことを確認。公開tarballを再取得し、ローカルの検証済みtarballと全バイト／SHA1／SHA512一致を確認した。認証URLやcredentialは記録しない。
公開コマンド：`npm publish ./tetorica-fm2612-0.2.35.tgz --access public --tag latest`。
配布物は2,047,368 bytes／展開後7,754,120 bytes。
`npm install tetorica-fm2612@0.2.35` で取得できる。git commit／push、SDK別repo公開は対象外。
