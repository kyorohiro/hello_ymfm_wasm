# tetorica-fm2612 0.2.34 npm公開 — 2026-10-30

**公開済み：`tetorica-fm2612@0.2.34`。npmのlatestも0.2.34。**
[公開パッケージ](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.34)。

ユーザーの「node package を更新する必要ある？」「進めて」に従い、0.2.33から更新してnpm公開した。
初期／編集Sineの周期先頭の段差を改善する `encodePs1AdpcmCycle` と、前回のnpm公開以降のSPU Gaussian補間・live ADSR／audition修正を含む。
一般録音用encoderの動作は維持。optionalなソフトmixer／host PCM bankのWASM exportsも同梱。
固定SDK 0.1.7は完全なsource付きの未公開ローカル候補であり、別途SDKを正式公開したという意味ではない。

## 公開物と検証

- パッケージversionとREADMEを更新し、build／npm pack／隔離install／385宣言の型検査を実施。
- 335 runtime modules、28 WASM engines、15 renderers、1097 local referencesを検証。
- 公開するtarballの1004ファイルが検証済みbuildとバイト一致。
- そのtarballを隔離installして新encoderと初期Sineの一致を確認。raw loop SNR 58.59 dB、実SPU出力のSine残差−61.37 dBc。物理音声出力は開いていない。
- npmの公開前はlatest 0.2.33、0.2.34は未使用であることを確認。
- npmログインと公開時の追加Web認証を経て公開。CLI終了コード0、HTTP 202で受付後、npm側の処理待ちがあった。再公開はしていない。
- 処理後、npm CLIと公開metadataの両方で0.2.34／latestを確認。公開tarballを取得し、検証済みtarballとバイト一致、SHA1／SHA512一致を確認した。

`tetorica-fm2612-0.2.34.tgz`：1,956,096 bytes、展開後7,436,346 bytes、1004ファイル。

SHA256：`58aea76145fee18837241d4dc93bb64e8cdc5b87bb13c2e8a8e306656c563dc3`。
SHA1：`89c8cbf9ced13462b712cc438a53d44667b7803e`。

完全なintegrity・固定SDK pin・検証情報は [JSON記録](npm_ps1_cyclic_release_01.json) を参照。
認証URLや認証情報は記録していない。公開直後のtarball URLには一時的な404 cacheがあり、query付き再取得で実バイトを検証した。

```sh
npm install tetorica-fm2612@0.2.34
```

今回の作業はnpm公開まで。Webサイトのdeploy、git commit／push、別リポジトリのSDK公開は行っていない。
