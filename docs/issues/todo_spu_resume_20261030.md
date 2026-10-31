# SPU Synth 再開時のTODO

2026-10-31追記：[Standalone安定性レビューと新しい配布候補](spu_synth_review_20261031.md)。
PMON変更拒否後の離鍵と、音声コマンド応答待ちの復旧を修正。下記v0.1.0 ZIPは過去版として保持する。

2026-10-30、仕事のため確認が難しくなる前の再開メモ。
次回はこのファイルから再開する。今回の作業では公開済みページを調査していないため、
itch.ioへのアップロード・devlog投稿の実施状況は最初に確認する。

後続報告：2026-10-30、ユーザーよりPlaygroundのリリース済み報告あり。
Playground公開は完了。公開URL・使用ZIP・devlog投稿状況は未記録。Standalone Synthの公開状況とは分けて扱う。

## いまの状態

- 確認開始時HEAD：`ef99ec18`、commit subject `v0.1.0`。
- PCM／ADSR／FX／Audio／**PSF / VAB** の5タブ。一般音声とPS1音色バンクを分離済み。
- VAB v6／v7、VH＋VB、PSF1／MiniPSF＋PSFLibに対応。Toneを読み込み、鍵盤演奏・preset保存ができる。
- ユーザーがPSF読み込みを確認済み。専用タブ追加後の最終ZIPはChromium／WebKitの全回帰成功。
  その過程でMorph checkboxの一時的な表示巻き戻りを修正済み。
- 製品の検証はNode 76 tests＋実AudioWorkletのPCM。今回の自動作業では実聴はしていない。
- 新機能の本体実装を増やす前に、公開状態と短い試聴を確認するとよい。

## 1. 公開状態を確認する

- [ ] itch.ioの公開ページが今回の版か確認する。**PSF / VAB** が独立タブになっていることが目印。
- [ ] まだアップロードしていなければ、以下の既存ZIPをHTML projectとして登録し、root `index.html` で起動する。
- [ ] 既存devlogを確認し、未投稿なら [英語devlog原稿](devlog_spu_psf_vab.md) を投稿する。
  原稿末尾の **Posting notes** は投稿本文から除く。投稿済みなら二重投稿しない。
- [ ] 公開URL・公開版番号・公開日・使用ZIPのSHA-256・devlog URLをこのファイル末尾に記録する。

現在存在する公開候補は次の2ファイル。同じbyte列であることを今回再確認した。

| ファイル | サイズ |
| --- | --- |
| `release/tetorica_spu_synth_dev_itch_v0.1.0.zip` | 5,529,017 bytes |
| `release/tetorica_spu_synth_dev_itch_v0.1.0_for.zip` | 5,529,017 bytes |

SHA-256は共通：`91c35b65cafdaa7fab495b1dc5a2f8db15c868b8db369a8e304e1f788ac0cef3`。
内部包装labelは`dev`、ファイル名と本体commitは`v0.1.0`。前回案内した末尾versionなしの
`release/tetorica_spu_synth_dev_itch.zip` は今回の確認時には存在しない。
これらのZIPを再作成する必要はない。製品を変更した場合は別候補を作り直し、新しい検証・hashを記録する。

## 2. 時間が取れたら3〜5分だけ試聴する

- [ ] 公開版を開き、Enable audio → 初期Sineで単音とドミソを弾く。
  過去に直した羽音・飽和による妙な響きが再発していないか確認する。
- [ ] `docs/playground/samples/spu-import/spu-psf-demo.zip` を展開する。PSF / VAB → Open PSF folderで **Demo** を選択。
  entry → Extract VAB banks → bank／Tone → Load selected Toneで演奏する。
  合成デモなのでゲーム音源を用意する必要はない。2 banksが表示される。

デモは [samples/spu-import](../playground/samples/spu-import/README.md) に保存済み。
`release` を消しても残り、Playgroundのpackage時に再生成・同梱される。
過去の公開ZIPを残す場合は削除前に別の場所へ退避する。PlaygroundのbuildだけではSynth ZIPは再生成されない。
- [ ] entry／bank／Toneを操作した後も、PC鍵盤で音が出ることを確認する。
- [ ] Save preset → Reset instrument → Load presetで音色が戻ることを確認する。
- [ ] PCMでSoftware morphをOn→Offにし、チェックと上段Morph表示が矛盾しないことを確認する。

ローカルで確認する場合の起動例（サーバーが終了していても復帰できる）：

```sh
python3 -m http.server 8877 --directory docs
```

<http://127.0.0.1:8877/synth-spu/>。`file://`直開きはAudioWorkletに対応しない。
公開確認には実際のitch.ioページ／アップロードしたZIPを使う。

## 3. 次の開発は複数作品の互換性確認から

- [x] 作品フォルダー内の全曲を調べるCLIを作る。
- [x] 合成データのCLI 7 tests＋共通パーサー9 testsを実行する。
- [x] Clock Towerの既存23 files／20 entriesを再検査し、以前の結果と全件一致を確認する。
- [x] 追加2作品をCLIで集計。Wild Arms 66 entries／Crash Bandicoot 25 entries、処理エラー0。
  ゲームファイル・抽出音色は一時領域のみ。リポジトリ・配布ZIPへは入れていない。
- [x] 各作品1代表候補を両UIでロード・発音測定。Chromium／WebKitの計12経路成功。
- [ ] 正しい本文との対応付けを確認後、代表Toneの音程・ループ・離鍵・元音色との一致を確認する。
  現状の非ゼロPCMは忠実度の証拠ではない。人の耳での試聴は未実施。
- [x] 検出なし・拒否理由と、本文の誤対応候補を記録し、次の課題を選ぶ。
  [調査記録](spu_psf_multi_title_01.md)。
- [x] VAB／SEQ混在による既知の誤候補を除外し、両UIとCLIに理由を表示する。
  [実装・検証](spu_psf_body_guard_01.md)：Node 128 tests／6ブラウザ経路成功、111 entries再検査。
  分離VH／VBの自動対応付けは後続。PSの追加機能はいったん区切れる。

```sh
node scripts/inspect_psf_banks.mjs /path/to/extracted-game-set --out /private/tmp/game-psf-report.json
```

[CLIの操作と結果の読み方](../../scripts/inspect_psf_banks.md)。出力にはADPCM／PCM本文を含まない。
`playableTones`は読み込み前検証の成功数であり、実聴・音の忠実度の判定ではない。
Clock Tower再検査は既知1作品の確認であり、複数作品のTODO完了とは数えない。

## 4. Playground配布準備はAI側で完了

2026-10-30の後続自動作業で、以下を完了した。
[再校正・配布候補・機械検証](playground_spu_vab_release_01.md) を参照。

- [x] 旧freshnessエラーを正規の新規測定で解消。PS1／WonderSwan／POKEYの完全行列を測定した。
- [x] 旧measurement JSONを保持し、新reportからpolicyを生成。PS1 gainは0.129331のまま。
  POKEYのprimary／dual-firstだけ測定の丸め差で1e-6変更。校正・生成関連385 tests成功。
- [x] 正規generatorの--check 2件、1,173 local references、ZIP CRC／itch.ioのentry上限を確認。
- [x] 新しいPlaygroundブラウザ用ZIPを作成・展開し、VAB／PSF／SPU全般それぞれ
  Chromium／WebKit × Main／Workerの計12経路で成功。PS1は生成設定の適用後も全経路再測定に成功。
- [x] Playgroundをリリースする。2026-10-30、ユーザー報告で完了。
- [ ] 公開URL・公開画面上の版番号・使用ZIP／hashを記録する。報告時のローカルHEADは617af9bb（v0.95.2）。
- [ ] 人の耳での短い試聴結果を記録する。今回の公開報告だけで試聴完了とは数えない。

ブラウザ公開用ZIP：
`release/hello_ymfm_wasm_psf-vab-dev-20261030_itch_playground_for_run.zip`。
37,438,814 bytes／931 files、root `index.html`。SHA-256：
`845bbd1d2b8481d4bae6d7de6f54017446b7df9b8155f69686991ba0cf049fc7`。
末尾`_for_run`なしは完全ソース展開版で、1,000 entry上限を超えるためダウンロード用。

元の停止エラーは `served DSP/WASM source changed; remeasure: docs/js/playground_ps1_inspector.js`。
今回の新しいreportで正規チェックが通っており、同じ未解決TODOとして再調査する必要はない。

この項目はStandalone SPU Synthの公開とは別。既存Synth v0.1.0 ZIPと過去の校正記録は変更していない。
その後、ユーザーからPlaygroundのリリース完了報告あり。上記候補のどのZIPが公開されたかは未記録。
Codexはアップロード・投稿・npm公開・git操作を行っていない。

## 後続候補と今は進めないこと

分離配置VH／VB、鍵域分割・layers、独自形式、runtime生成bank、CPU／ドライバ実行は
[音色インポートTODO](todo_spu_synth_import_01.md) に残す。対応範囲を一度に広げず、実データの必要性から選ぶ。
外部入力ReverbとMorph LFOはユーザー判断で現時点では不要。未完了実装として再提案しない。

## 再開後の記入欄

- itch.io公開URL：未記録
- 公開版番号・公開日：未確認（ローカルcommit／ファイル名はv0.1.0）
- 使用ZIP／SHA-256：未記録
- devlog URL：未記録
- 試聴したブラウザ／OS／確認結果：未記録
- 追加作品と結果：[Wild Arms／Crash Bandicootの機械調査](spu_psf_multi_title_01.md)。候補数を復元成功数と混同しない。
