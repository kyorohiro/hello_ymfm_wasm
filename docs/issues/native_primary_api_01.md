# Native主音源APIのMain／Worker一致

2026-10-23。全ModeのNative化・安定性検証の後、追加チップ対応の前に、
現在の主音源を取得する公開APIの差を確認した。

## 問題

Genesis／Mega CD／32X／32X Nuked／旧Genesis Nukedで、Mainでは
`await useSoundChip('segapsg')`が内蔵PSGを返すが、Workerでは追加チップ生成へ進んでしまう。
Nativeの追加チップ生成は未対応のため、同じコードがWorkerでエラーになる。
初期コードは直接`psg`を使うため、既存のMode一巡テストでは見つからなかった。

付随するMain／Workerの差も確認した。

- Workerの内蔵PSGに`id`がなく、取得した音源を`mixer.set(chip.id, ...)`へ渡せない。
- Mainで利用できるPSGの`setStereo()`がWorkerにない。
- Workerの汎用FMプロキシが、借用した主音源にも実体のない`dispose()`を返す。

## 修正

WorkerでもNativeの主音源PSGを優先し、同時の取得要求を同じハンドルへまとめる。
FMは`ym2612`、PSGは`segapsg`の既存ミキサーIDを使う。
PSGのステレオ操作は既存の`psg-stereo`命令へ接続し、時刻・owner・Stopの管理を共有する。
借用した主音源には独立インスタンスの破棄APIを追加しない。

音源コア、ミキサーの接続先、音声callbackの処理は増やさない。
`createSoundChip()`によるNative追加チップ生成は今回の対象外。

```js
const fmChip = await useSoundChip('ym2612');
const psgChip = await useSoundChip('segapsg');
// Genesis系Nativeでは fmChip === fm、psgChip === psg。
await mixer.set(psgChip.id, {volume: 0.6, pan: -0.25});
psgChip.setStereo(0xff);
psgChip.tone(PSG1, {note: 'C4', attenuation: 7});
```

## 検証

実際のlogic WorkerをNodeのworker_threadsで実行し、実MessagePortとNative用Runtimeへ接続する。
Genesis系5モードのMain／Workerで、同時取得・同一性・ミキサーID・ステレオ値の検証、
追加生成へ進まないこと、Stop／再Run、音源セッションの再利用を確認する。
Native IPCは模擬し、物理音声デバイスは開かない。

Chromium／WebKitにも`--primary-lookup-only`の確認を追加する。
表示されるGenesis系4モードでMain→Worker→Worker再利用→Mainを実行し、
FM／PSG命令・ステレオ・ミキサー接続数・セッションを確認する。

ソース版・Tauri取り込み後の最終配布版ともに、両ブラウザーで16回ずつの実行が成功。
Native用のAudioContext／AudioWorkletを作らず、追加ミキサー音源も作らないことを確認した。
実Workerを使う5件と既存関連95件も成功した。
最終のJS全体は4,065件成功、既存1件skip。SNESと実Workerの関連10件は
4並列で12回繰り返し、合計120件すべて成功した。

全体テストで、既存SNESのWorkerテストに固定15msの待機では命令配送が終わらない場合があった。
同じMessagePortへ送る`readDsp()`の応答を待ち、先行するkey-onの配送を確認する形へ修正した。
待機時間の延長やSNESの再生処理の変更はしていない。

最終フロントエンドは845ファイル、SHA-256
`3471939f59a2a1afaaac0afde73aeadb908e7101a66bfc45d1da7f412e8f50d8`。
同梱NativeソースZIPは1,304ファイル、SHA-256
`e92612832de760724a4a441674c285188bb3a86e6e78a91736856124617da4c3`。
原典21種類・checkout・ZIP内manifestとの照合も成功した。

```sh
node --test web/native_genesis_borrowed_worker_runtime.test.mjs
node scripts/check_playground_native_backend_browser.cjs --primary-lookup-only
```

## 次の追加チップ対応に向けた確認

既存Modeの固定構成を保ち、独立した小さいラックを加える方式なら段階的に進められる。
最初の候補は単独コアを持つSega PSG。ユーザー用ミキサーIDとは別に、
sessionと世代を含むNativeの識別子が必要になる。
古いWorkerの命令やdisposeが、同じIDで作り直した音源へ届かないようにする。

作成は制御側で行い、callbackへ所有権を渡し、破棄も制御側で回収する。
インスタンス数・待機命令・破棄待ちには上限を置く。固定Modeを一斉に新ラックへ移さない。
YM2612は現在のFM＋PSG複合コアをそのまま複製せず、独立FM用APIを用意してから扱う。
このラックは設計上の候補であり、今回実装した機能ではない。
