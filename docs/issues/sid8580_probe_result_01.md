# 専用8580コアの調査・独立Native／WASM試作（2026-11-07）

sidera 1.1.1を固定し、独立したNative／WASM試作でcycle単位のread／writeと比較を行った。移植一致と性能の入口は確認できたが、write-only bus等が未実装のため**本番採用は保留**。SID Player／Synth／SDKは変更せず、既知8580の拒否も維持した。

## 固定sourceと試作の範囲

[候補比較・一次source](sid8580_core_selection_01.md)に必要なlicense closureと採用／保留理由を残した。今回使うのはMITの依存なしlibrary部分で、optional Cargo playerやその依存は使わない。

- sidera 1.1.1 revision: `15041709d26c2bc36667ba27f729332c9f523696`
- 原本crate SHA-256: `b043512b891bdb03ad21b0205723dabb88ada23e3043c21f6a7f88b26defba35`
- `third_party/sidera/upstream/`に原本、`adapted/`に最小cycle-access patch、原本／改変hash・変更点・MIT licenseを保持した。変更点は`PATCHES.json`とsource内の明示で記録し、既存のsample API・filter式は変更していない。
- MAMEは現行音源本体や旧版の必須波形表がGPL、perfect6581は必須netlistがCC BY-NC-SA 3.0でdigital-only。wrapperやrepositoryの表示だけを根拠にpermissiveな配布音源として採用しなかった。
- BSD wrapperの独立probeはPAL985248Hz、6581／8580を選べる。`w`／`r`はclockを進めず、`c N`で正確にN chip cycles進める。出力sampleの整数phaseは0から開始する。本番のregister APIやPlayerへ追加した機能ではない。

## 検証結果

| 確認 | 結果 | 証拠 |
| --- | --- | --- |
| Native／WASM PCM・read・chunk一致 | 14fixture × 3rates × 2models、84ケース | [verification](sid8580_probe_verification_01.json) |
| 元の`clock()`／`clock_with_voices()`・read・reset | 6設定、376,200samples完全一致 | [元API比較](sid8580_legacy_api_01.json) |
| 外部libresidfpとの比較 | 28ケースの診断のみ、精度の合否判定なし | [verification](sid8580_probe_verification_01.json) |
| Chromium／WebKitのPCM・read一致 | 各28、計56ケース。48kHzの単体WASM | [browser](sid8580_probe_browser_01.json) |
| matching source単独再build | 53inputs、Native／WASM／receiptがbyte一致 | [source kit proof](sid8580_probe_sourcekit_01.json) |

fixtureはphase／envelope、TEST／release、Triangle／Saw／Pulse／Noise／combined、Sync／Ring、filter sweep／routing、volume／DC、write-only busを含む。cycle／frame数、異なるrender分割、Stop／reset、無効引数、stale handle、16instance上限、末尾不正入力でPCMを出さないことも確認した。

Apple M2のNode測定は48kHz・約3.2秒分のbounded batchで、WASM約70～73倍、Nativeはprocess起動込み約75倍の実時間速度だった。ブラウザーも約70倍前後。Nodeのlinear memoryは1,310,720bytes。この値にC64 CPU、AudioContext／AudioWorklet、実時間schedulingや音切れの検証は含まれず、C64 CPUを含むPlayer接続後の性能保証ではない。将来の接続では1cycleごとのJS↔WASM往復を避ける構成も検討する。

## 差分と採用を保留する理由

- **write-only bus**: 試作は両modelとも`[0,0,0]`、8580参照は`[165,165,165]`（6581参照は`[165,165,0]`）。latch／保持・decay／read後のbus更新とPOTは未実装で、CPUの分岐・model検出を変え得る。
- **初期条件**: 試作はoscillator／envelopeが0。参照は`0x555555`／`0xAA`を保持するため、最初のreadやPCMが異なる。初期値、pipeline、真の発振・ADSR差を分ける必要がある。
- **8580音声段**: model固有offset／filter分岐は存在するが、resonanceは両model共通の近似。combined waves、cutoff、DAC／DC、外部RC／scaleも参照と異なる。raw RMS比を音量補償や音質評価へ転用しない。
- **sampling**: 試作の整数phaseと、参照DECIMATEの1/1024cycle周期・初回sampleが異なる。参照の実frames／divisor／実効rateを保持し、無補正のcommon-prefix差をすべてSID内部の誤差としない。

外部参照は固定libresidfp 1.2.3を使う新しいGPL検証binaryで、`SID8PROBE 1 RATE MODEL`というraw bus protocolを持つ。既存strict PSID参照CLIは変更していない。GPL binary／libraryは検証用の別processに留め、MIT／BSDの候補WASM・source kitへ含めない。Native／WASM一致は移植一致であり、参照エミュレーターとの一致や実機忠実度の証明ではない。

## 再build・source archive

```sh
sh scripts/build_sid8580_probe.sh
node scripts/check_sid8580_probe.mjs --out build/sid8580-probe/verification.json
node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe
```

必要なのはNode.js、Rust1.91.1と`wasm32-unknown-unknown` target。Cargo依存解決やoptional playerのbuildは行わない。外部診断を追加する場合だけ、既存の固定GPL installを使う別builderを実行する。

```sh
node scripts/prepare_sid8580_reference.mjs
node scripts/check_sid8580_probe.mjs --reference build/sid-reference/sid8580-reference
```

| 再build済み出力 | bytes | SHA-256 |
| --- | ---: | --- |
| WASM | 1,390,542 | `96abb0664a7aa7f3df7b1a63fa8f9b8e576a492936ce4175db1fd7019b4610bd` |
| Native | 482,976 | `b78675ae378cf8c15c77b573e3839df5f50893b591b11fddb611ad828954b1a0` |
| source ZIP | 541,950 | `244d0aa1f07ea70728bca200f94d0a89e1b61b488ea49af79ca09738c557bd8d` |

最終`release/tetorica_sid8580_probe_20261107_sources.1.zip`は71files、matching source／license／WASMを含む可読source kit。WASMに含まれるRust1.91.1標準ライブラリーについて、installed toolchainの無変更`COPYRIGHT-library.html`と付属license・notice provenanceも`third_party/sidera/toolchain-notices/`に同梱した。これは未buildのoptional Cargo player依存とは別で、53app inputsとNative／WASM／receiptの再build一致は変わらない。Native binary、GPL SID参照、ROM／ゲーム音楽は含めず、CRC・全ZIP fileのbyte一致も確認した。固定runtime33builds／68outputs／75mirrorsと既存Player／native receiptは保持・検証した。

新しい`.github/workflows/sid8580-probe.yml`は独立Native／WASM・元sample API・receiptを検証する。GitHub Actions実行、push／commit／tag／公開はまだ行っていない。

次はbus動作、初期条件を揃えた外部品質比較、各core自身のreadをCPU分岐へ返す自作closed-loop fixtureが採用前の条件になる。その後に実8580曲・PSID／RSID・C64／Worklet・実聴と安定性を確認し、採用判断後にModel UI／parser／Main・Worklet／Native ABIへ接続する。今回の結果をPlayerの8580対応完了や実曲再生成功として扱わない。
