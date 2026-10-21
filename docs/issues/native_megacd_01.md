# Mega CDのNative音声対応

2026-10-21。GenesisのNative音声経路にRF5C164を加え、Mega CD modeを扱う。
Web Audioは引き続き既定。32X／32X Nukedは今回の対象に含めない。

## 音声経路とAPI

- Genesisで使用中のYM2612＋Sega PSGに、既存のC++ RF5C164音源を加える。
  ブラウザー用WASMと同じMAME由来のコアを直接ビルドする。
- RF5C164は12,500,000 Hz、8声、64 KiBの共有RAM。
  PCMを生成してからFM／PSGと混ぜ、共通のC FX → liveFx → master → fade → clipへ送る。
  Audioタブと録音には処理後の最終出力が入る。
- `await useSoundChip('rf5c164')`はmodeに内蔵した1個の音源を借りる。
  Main／Workerとも既存の`loadMemory`／`loadSample`／`setChannel`／`setPitch`／`keyOn`／`keyOff`を使う。
  追加インスタンスや32X PWMをWeb Audioで同時に鳴らす経路は作らない。
- サンプラーは既存のSample Editor／`inputAudio`／`createSampleInstrument`を使う。
  ファイル・マイク入力と編集はWebView、PCMの再生はNative側で行う。
  圧縮音声のデコードは読込み時だけ既存のofflineデコーダーを使う。
- Keyboardの対象にRF5C164の8CHを表示する。RAMとチャンネル設定を用意した後に試聴できる。
  適用済みレジスターのスナップショットを要求時に取得し、連続したPCM転送や新たなAudioNodeを作らない。

## 時刻・停止・負荷

- FM／PSGと同じNativeフレーム時刻、Worker lookahead、session／loop ownerを引き継ぐ。
- 高級APIの`keyOn`／`keyOff`は、適用時点のチャンネルマスクを使う。
  先読み時に作った全CHマスクで、途中のKeyboard入力や別loopの声を上書きしない。
  明示的なレジスター8への書込みは、従来どおり全CHマスクの操作として扱う。
- Stopは共通のfadeと停止barrierを使い、RF5C164の声も止める。波形RAMは保持する。
  古い非同期loadやWorkerの後処理が、次のRunへ書き込まないようにする。
- 波形の転送・検証・メモリー確保は制御側で行う。
  音声callbackでは既存領域へのコピーと生成だけを行い、payloadの最後の参照は制御側で回収する。
  1バッチのRAM転送は64 KiB、Native側の保留は8 MiB／4096個まで。
  JS側も未送信・送信中を合わせて4 MiB以内に制限する。
- RF5C164の追加だけではliveFx用の2048フレーム先読みを有効にしない。
  liveFx未使用時は従来のNative直接出力を使う。

クロック変更はWeb Audioと同じ外側のレート変換を使う。内部コアは12.5 MHzを保ち、
半分・1.25倍・2倍等の進み方を変更する。reset時は変換の位相を初期化して設定rateは保持する。
Keyboardの基準stepは適用済みのscript設定を別に保持し、試聴時の移調やStopで基準がずれないようにする。

## エンジンとModeの選択

Nativeを選べるmodeをGenesis／Mega CDに広げる。
Native中のMode一覧にもこの2つだけを表示する。他modeではNativeを選択できない。
mode変更は既存の新規コード／コード維持ダイアログとプロジェクト引継ぎを使う。

## RF5C164を含むVGMのインポート

Mega CD modeのVGM変換では、High／Write／Scheduleとも内蔵RF5C164を
`await useSoundChip('rf5c164')`で借りる。以前の生成コードは`createSoundChip`で
別の音源を作っていたため、Nativeの追加チップ制限に掛かっていた。
既存のインポート済みコードは自動では書き換えない。Mega CD modeで再インポートする。

借用した音源に`dispose()`は呼ばず、使用したCHだけをkeyOffする。
hot Runの古いcleanupが新しい再生を止めないようleaseを確認する。
再生開始時はRFのclockを12.5 MHzへ戻し、RAM転送の時刻やFM／PSGとの既存の変換方式は維持する。
他modeで追加音源を使う従来のWeb Audio変換は、独立した音源の生成・破棄を継続する。

変換器の14テストと、実ブラウザーのインポート→High／Write→Main／Worker再生で確認した。
NativeでRF5C164を追加生成しようとした場合は、内蔵音源の使い方と必要なmodeをエラーに表示する。

## 検証

実NativeとWASMのPCM比較、実Rust Rendererの停止・取消し・ミキサー・FX・録音、
実ブラウザーのMain／Worker・初期コード・サンプラー・Keyboard・mode切替を分けて確認する。
Native IPCを模擬したブラウザーテストは、実Native音声の試聴とは区別する。
物理出力・マイクを開くテストは実行しない。

| 検証 | 結果 |
| --- | --- |
| 実Native RF5C164とWASM | 44.1／48／96kHz、21ケース・98,304ステレオフレームで最大差0。8声、pitch／pan、end marker／loop、RAM／bank、Stop／reset、音量ramp、動的clockを確認。[結果JSON](native_megacd_validation_20261021.json) |
| JS関連テスト | 471件成功。RFの追加10件、Worker RPC、既存FM／sample／noise／FX／liveFx／Keyboard／Runtime等を含む |
| Tauri Rust全体 | 103件成功、4件ignored。追加RFテスト8件で適用時刻・所有者・voice lease・音程基準・RAM保持・共通FX／master／録音を確認 |
| 実ブラウザー | sourceのChromium／WebKitと、取り込み済み配布物のWebKitで成功。初期コードのMain／Worker、実FLACデコードとRF転送、Keyboard、複数音サンプラー、Stop、monitor／録音、mode切替・非対応modeの拒否を確認。Native IPCは模擬 |
| 配布物 | 790アセットを取り込み。archive SHA-256 `01d6a62d7cfd954f2ef21bc432e18a2e6d8f09b1e0a40f310a2f497fed9ba166`。RF由来6ファイルのhashも上流リポジトリーと一致 |
| ビルド | 最終配布物取り込み後の`cargo build --offline --locked`成功。RFライセンスをbundleリソースへ追加 |

物理デバイスでの試聴・マイク入力・長時間安定性は未実施。
PCMの一致はRF音源とレート変換の比較であり、デバイスが実際に鳴らした音の録音ではない。

再実行（ルートリポジトリーから）:

```sh
node scripts/check_native_megacd.mjs --out /private/tmp/native-megacd-parity.json
node scripts/check_playground_native_backend_browser.cjs --webkit --out=/private/tmp/native-megacd-browser
```

Tauri側:

```sh
python3 scripts/sync_native_megacd.py --check --source ../..
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml
```
