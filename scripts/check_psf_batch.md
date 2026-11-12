# PSFフォルダーの無音バッチ診断

展開済みのPSF1／MiniPSFセットを短時間ずつ実行し、依存不足・未対応処理・時間切れと、PCM／SPUの観測結果をJSONへ記録します。SPU Synthと同じPlay! CPU/HLE＋MAME由来SPUのABI 4コアを使います。ブラウザー、音声デバイス、ネットワーク、WASMの再ビルドは不要です。Node.js 22以降でrepositoryのルートから実行します。

```sh
npm run psf:batch -- "/path/to/extracted-game-set" --out /private/tmp/game-playback.json
```

標準出力は最終JSON、標準エラー出力は曲ごとの進行表示です。JSONだけを別ファイルへ流す場合は`npm run --silent psf:batch -- ...`、または直接`node scripts/check_psf_batch.mjs ...`を使います。`--out`は必要な親フォルダーを作り、診断開始時・各曲の完了後・終了時にJSONをatomic置換します。中断しても完了分を読み直せます。既存のJSONは上書きしますが、PSF入力やsymlinkを出力先には指定できません。

ZIPは先に展開し、その曲が参照するPSFLibも同じフォルダー階層に含めます。複数作品は作品ごとに実行してレポートを分けてください。`.psf`／`.psf1`／`.minipsf`／`.minipsf1`が曲、`.psflib`／`.psf1lib`は依存ライブラリーです。フォルダー内の大文字・小文字の違いと相対ライブラリー解決は既存loaderと同じ規則です。

## 曲と時間を指定する

```sh
node scripts/check_psf_batch.mjs "/path/to/set" --entry "tracks/song.minipsf" --seconds 5 --out /private/tmp/one-song.json
node scripts/check_psf_batch.mjs "/path/to/set" --max-entries 10 --seconds 2 --timeout-ms 10000 --batch-timeout-ms 120000 --out /private/tmp/first-ten.json
```

- `--entry`：選択フォルダーからの正確な相対パス。省略時は全曲を相対パス順に選びます。
- `--seconds`：曲ごとの先頭からのrender時間。既定2秒、0.05〜30秒。PSFのlength／fadeタグによる自動終了・fadeは行いません。
- `--max-entries`：選択した曲の先頭何曲を処理するか。既定512、1〜512。意図して省いた曲数を`excludedByLimit`へ記録します。
- `--timeout-ms`：1曲のプロセス起動・入力解析・初期化・render・終了までの実時間上限。既定10,000 ms、100〜120,000 ms。
- `--batch-timeout-ms`：探索と全曲を合わせた実時間上限。既定300,000 ms、100〜3,600,000 ms。使い切ると未処理曲を残して終了します。
- `--out`：任意の`.json`出力先。省略時は標準出力だけです。

各曲を独立したNodeプロセスで順に実行します。同期WASM内で処理が戻らなくても、親が実時間timeoutでSIGKILLし、子の終了を待ってから次へ進みます。Ctrl+Cでも実行中の子を回収し、終了コード130と最終部分レポートを残します。SIGTERMの終了コードは143です。

## 結果の読み方

`status: complete`は選択した曲の診断をすべて終えた意味で、すべての曲の成功を意味しません。各曲の`status`と`summary`も確認します。

| 項目 | 意味 |
| --- | --- |
| `results[].status: rendered` | 指定した数の音声frameを生成できた。無音も含み、音の正しさは判定しない。 |
| `error` | PSF／依存／起動条件／未対応処理／非有限PCMなどの理由で診断できなかった。`phase`・`error.code`・`message`を確認。 |
| `timeout` | 1曲またはbatchの実時間予算が尽きた。直前に届いたphase／frame進行を記録。 |
| `crash` | 子が異常終了、または結果を返さず終了した。終了コード・signal・上限付きstderrを記録。 |
| `aborted` | 外部から中断した。未着手の曲を失敗扱いにはしない。 |
| `summary.remaining` | 選択したがまだ診断結果がない曲数。実行中に中断した曲は`aborted`として結果に含め、未着手の曲とは分ける。first-N除外とは別。 |
| `metrics.pcm` | 元の44.1 kHz stereo Float32 PCMのhash、有限／非有限数、左右のpeak／mean／RMS、無音フラグ。gain補正・正規化・wav保存は行わない。 |
| `metrics.nativeFrames` | native音声clockがrender分進んだか。CPUが音楽的に正しく動いている証明ではない。 |
| `snapshots.first/final` | 最初／最後の24CHレジスター、Gate／active／envelope／Pitch、共有設定。波形bytesは含まない。 |
| `activity` | 約0.1秒ごとのchunk境界で観測したCH活動の和。短い発音や途中のRAM書換えをすべて拾うtraceではない。 |
| `spuRam` | 512 KiB SPU RAMの最初／最後のSHA256、非zero byte数、変化したbyte数。RAM本体やサンプルは保存しない。 |
| `sources`／`loadedFiles` | 当該entryに必要だった入力のpath・size・SHA256と、実際のoverlay順。長い一覧には総数と明示的な省略フラグがある。 |

無音は、曲の導入・待機・短い一発音の後などでも起きます。`rendered`と`silent`だけで正常／異常を決めず、必要なら時間を延ばしたり、Synthで別途確認してください。失敗する前に生成できたchunkの統計も保持します。失敗した最後のchunkでnative clockだけが途中まで進んだ場合は`unaccountedFrames`で区別します。

入力の誤りは、必要なentryと依存だけを解析して分離します。壊れた無関係な曲／libraryが混ざっていても、正常な曲の検査を止めません。`missing-library`、`ambiguous-library`、`invalid-container`、`unsupported-psf-version`、`invalid-entry-point`、`unsupported-runtime`などを区別します。実行中のファイル変更も検出対象です。

`scanComplete: false`は探索を完了していない状態で、曲数が0でも空フォルダーだったとは限りません。`incomplete`／`aborted`は未処理が残る場合があります。探索エラーや未知の`--entry`もreportの`error`へ記録します。

## 終了コードと上限

終了コード0は、選択した全曲が`rendered`になった場合（無音を含む）。1は引数・探索・曲単位のエラー、timeout、crash、不完全なbatch。Ctrl+Cは130、SIGTERMは143です。

探索はPSF関連512ファイル、深さ64、16,384ディレクトリー項目まで。読み込める16 bytes〜4 MiBのファイル合計は64 MiBまでです。小さすぎる／大きすぎるファイルは読み込まず、そのentryに理由を記録します。選択したrootはrealpathへ解決し、その下のsymlinkは追いません。

各子のJavaScript heapは256 MiB、結果IPCは128 KiB、stderrは8 KiB、全JSONは80 MiBまでです。WASM memoryやプロセスRSS全体を256 MiBに制限する仕組みではありません。独立プロセスと予算による診断上の分離であり、OSのsecurity sandboxを提供するツールではありません。

これは短い区間で実行できるかの診断です。実聴、全曲・長時間の安定性、cycle-exactなPS1再現、すべてのゲーム互換性を保証するものではありません。PSF2は対象外です。元VABと実行後RAMのsample対応の証明もまだ行いません。標準bankの静的抽出を調べる場合は、別の[inspect_psf_banks.mjs](inspect_psf_banks.md)を使います。

## 開発時の確認

```sh
npm run test:psf-batch
```

自作のMIPS／PSFプログラムで、実PCM・MiniPSF overlay・無音・不足library・CRC・未対応処理を確認します。別の停止しないテストworkerでhard timeout、crash後の継続、中断、子の回収、atomic checkpointも確認します。ゲームのファイルや音声をテストへ追加しません。

既存のSPU Synth GitHub Actionsにもこのテストを接続しています。実データのフォルダーやゲームファイルはCIへ送信・同梱しません。
