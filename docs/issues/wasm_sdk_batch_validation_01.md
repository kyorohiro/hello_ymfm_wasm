# 全27 WASMビルドの一括検証

日付: 2026-10-26

## 使い方

```sh
npm run test:wasm:sdk
```

Node 22以降・Python 3・Emscripten・sh・Perlを用意すると、npm依存のinstallや別checkoutなしで実行できる。
直接実行は`node scripts/check_wasm_sdk.mjs`。出力先を選ぶ場合は、既存の親ディレクトリー内の新しいパスを指定する。

```sh
npm run test:wasm:sdk -- --work-dir /tmp/tetorica-wasm-check
```

既存SDKの`build-wasm.sh all`を使い、checkout外の新しい作業ディレクトリーで27種類を生成する。
既存の生成物、Web／docsのDX7 runtime、Mixer値は書き換えない。
`summary.json`、build／音源別ログ、`reports/<artifact>.json`、参照と再buildの生成物・receiptを残す。

## 検証範囲

新しい`scripts/wasm_sdk_inventory.mjs`で、固定SDKのcatalog・manifest・pinを検証する。
ビルド記録は必須。27件のID・format・source一覧／fingerprint・compiler情報・実sourceのhash／sizeと、
53出力の一覧・hash／size、WASM imports／exportsを確認してから生成JSを使う。
26組のES moduleとDX7 standaloneを区別し、欠落・重複・余分なartifactや自己整合だけの偽造receiptを拒否する。

一括runnerは現在の`docs/generated/`を作業領域へコピーし、再buildした全27音源へ既存の実PCM／API checkerを適用する。
終了時は元の参照先・コピー・候補・実行前のrepository入力を再確認する。
DX7の中央出力と既存Web／docsの3コピーも照合する。
DX7 checkerから旧`w/tetorica-msfa-dx7-wasm`の必須参照を除き、SDKの実32 compiler入力・license・runtimeを引き続きguardする。
比較用に渡した旧binaryのソース由来を、現在のSDKソースだと推定するものではない。

上書き防止のため、空でも既存の作業ディレクトリーは使わない。
入力・checkoutとの重なり、symlink alias、危険なTMPDIRは作成前に拒否する。
引数や出力場所の不正は出力を作る前に拒否する。作業領域を作成した後の失敗は非zero終了し、
失敗したphase／artifactと、成功しなかった比較・残りの未実行項目を記録する。
POSIXでtimeoutになった場合は、shellだけでなくcompiler等の子process群も停止させる。

`--sdk-dir`では全27件の有効な再build出力を再利用し、`--reference-dir`では別の完全な参照出力を指定できる。
双方とも現在のpinと一致するreceiptが必要で、元ディレクトリーには書き込まない。
異なるSDKソースの歴史的receiptを任意に許可するmodeは追加していない。

## CI

[WASM SDK build and parity](../../.github/workflows/wasm-sdk.yml)を追加した。
Ubuntu 24.04・Node 22・Python 3.12・Emscripten 6.0.6で、3つの新試験fileと同じ一括コマンドを実行する。
actionは既存SDK workflowで使われている5つのSHAに固定した。
push／pull request／手動実行に対応し、失敗時にも診断用artifactを7日間保持する。
既存のVGM workflowのrecording compilerによる経路試験は維持する。

今回、remote workflowの手動起動や結果確認は行っていない。

## ローカル結果

着手時の本体は`3fedff04324d7946daf56f01a4a34146465898c1`でclean。
同梱SDKは従来の`0.1.1`／379ファイル、revision `e4b7d7ecef60e3927ac04815cd9f985f62c82f04`を保持した。
詳細な出力hash・音源別比較数・独立監査は[検証JSON](wasm_sdk_batch_validation_01.json)を参照する。

- receipt validator 55件・runner 14件・別checkoutなしDX7 12件、計81試験が成功した。
- 実Emscripten `6.0.6-git`による全27ビルドが成功した。今回のbuild時間は64.762秒。
- 27 checkerの合計39,982比較が差0。比較実行時間の合計は70.106秒。mono／stereo frameは合算していない。
- 候補の53ファイルは現在の配布生成物とすべてbyte一致し、source／buildの固有164入力と1,952 repository入力の不変を確認した。
- `git archive`の`d98c245fc7316c7eafb7872c546458d6ec847f8e`を別の場所へ展開した。
  3,444 fileで、`.git`・`w/`・`node_modules`はない。このコピーから再build済み出力を`--sdk-dir`で再利用し、
  同じ27件・39,982比較が成功した。2回目はcompilerを実行していない。同じfixtureの再確認なので固有coverageを倍には数えない。

証跡は`/private/tmp/tetorica-wasm-sdk-all-rpl7z7np/`。
通常の実build結果は`work/summary.json`、依存checkoutなしの再確認は`fresh-work/summary.json`。
runtimeのJS／型・生成物・SDK source／pin、Mixer数値、音色は変更していない。

既存checkerの混合engine fixtureは、相手側にcommit済みの音源binaryを使い、候補を1音源ずつ置き換える比較。
再buildした全音源をBrowserで同時演奏する検証や、AudioWorklet timing・Native／Tauri・実機聴音の検証ではない。
npm／itch.io配布物の作成・公開も行っていない。
SPCのWebKit初期化中closeは、引き続き別の未解決事項として残す。
