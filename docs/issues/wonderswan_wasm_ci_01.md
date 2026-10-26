# WonderSwan追加後のWASM SDK CI修正

2026-10-27。
[WASM SDK build and parity #10](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40377361314)
（`92b1ba87a872e745a466d1006d5effbde27590c1`、job `121763965725`）の失敗を修正した。

## 原因

最初のNodeテストが81件中3件失敗し、全27ビルドのステップへ進んでいなかった。
ローカルでも同じ失敗を再現した。

`docs/generated/`には固定SDK 0.1.2由来の53出力に加え、独立レシピで作った
`wonderswan_wasm.js`／`wonderswan_wasm.wasm`が入っている。
SDK検証はディレクトリ内のJS／WASM全体を53ファイルと完全一致させるため、WonderSwanを余剰と判定した。
同じ検証を使う本体runnerも、前段テストだけ修正した場合は参照元の検証で停止する状態だった。

その修正後、全27種類のビルドは成功したが、Nukedの比較がWeb／docs wrapperの同期照合で停止した。
WonderSwan Mode追加時に更新した`?v=wonderswan-mode-2`が、既知キャッシュ番号の許可一覧に含まれていなかった。
同じ一覧を使うYM3438／YMF276／YMF288の検証にも影響していた。

## 修正

- `verifyWasmBuildDirectory()`へ明示的な`allowStandaloneArtifacts`を追加。初期値は`false`。
- 参照ディレクトリの検証だけ共存を許可する。コピー後のSDK参照snapshot・再ビルド出力・prebuilt SDKは厳密な53出力を維持する。
- 共存可能なのは既知のWonderSwan 2ファイルのみ。両方の存在、独立receiptのschema／artifact／出力名・個数、実byte数／SHA256、WASMのmemory／`wonderswan_generate`を検証する。
- 未知のJS／WASM、欠損・改竄・不正ABI、検証ディレクトリ外を参照するsymlinkは引き続き拒否する。
- 4つのwrapper同期照合で、既知のキャッシュ番号`wonderswan-mode-2`を許可する。コードやimport先パスの差を無視する範囲は広げない。
- SDKの27種類／53出力、固定pin、音源ソース、WASM、Mixer値は変更しない。

ここで追加したのはWonderSwanの**出力**の照合。独立receiptの入力ソース全体とNative／WASMの音声一致は、
既存の`npm run test:wonderswan`が担当する。SDKの入力検証をWonderSwanへ適用したと扱わない。

## 検証

CIと同じ前段コマンドは、回帰試験を追加した93件すべて成功した。
以前は余剰ファイル判定で隠れていたSDK source改竄／symlink試験も、本来のエラーを検出して成功する。

```sh
node --test test/wasm_sdk_inventory.test.mjs test/check_wasm_sdk.test.mjs test/check_dx7_wasm_sdk_cli.test.mjs
node scripts/check_wasm_sdk.mjs
```

ローカルの新規ビルド先は`/private/tmp/wonderswan-ci-10-fixed-sdk-build`。
全27種類／53出力の再生成は成功した。その後見つかったキャッシュ番号の修正後、同じ新規生成物を
`--sdk-dir`で再利用し、`/private/tmp/wonderswan-ci-10-fixed-parity`で全比較を完了した。
**39,982件のPCM／API比較が差0、53出力すべて配布済み版とbyte一致**。検証中の入力ファイルも不変だった。
独立WonderSwanの2出力は参照側で照合され、SDK候補の53出力には含まれないことも確認した。

結果・入力hash・ビルドと比較の記録は[JSON](wonderswan_wasm_ci_01.json)を参照。
GitHub上の再実行には修正をcommit／pushする必要がある。
この作業でcommit／push／workflow dispatchは行っていない。

後続確認：ユーザーが修正を`23f1328260d38a67aad74894fe914b54a6578c81`へcommit／pushし、
[run 40379809938](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40379809938)が成功したことを確認した。
