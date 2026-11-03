# リポジトリー直下のフォルダー整理

2026-11-03。ユーザーの「cli...webまで、直下のFolderが雑然としている」を受けた調査・配置案。同日の「進めて」を受け、教材・利用例の整理とテスト分離を実装した。追加指定「src/、examples/はymfm由来だからそのまま」「tetorica_src、tetorica_examplesにまとめますか」を優先し、上流と独自追加を分ける方針へ更新した。2026-11-04、共有runtime・Node・CLI・Native FX・WASMブリッジの移動と配布経路の更新まで実装した。

関連：[web/と生成物の整理](todo_web_organization_01.md)、[現在のソース案内](../../tetorica_src/README.md)。Tetoricaの既存4つのGoalを維持する。

## 目指す配置

ymfm由来の`src/`・`examples/`は元の配置で維持する。Tetorica独自実装は`tetorica_src/`、独自の利用例は`tetorica_examples/`へまとめる。フォルダー数を一律に減らすより、由来と編集場所を明確にする。管理対象の直下は下記10フォルダーになった。

```text
src/                        # ymfm由来。現在の配置を維持
examples/                   # ymfm由来のbuildall/・vgmrender/を維持
tetorica_src/
  runtime/                  # 旧web/。Browser/Node共通の音源JS、Synth、Worklet等
    generated/              # 全WASM・loader・metadataの正本
  node/                     # Node音声出力・Workerアダプター
  cli/                      # VGM CLI / Node解析APIの入口
  native/                   # Tetorica独自のNative FX
  wasm/                     # 旧wasm/。独自ブリッジと比較検証用のビルド入力
tetorica_examples/          # 実装済み。独自のbrowser/、nodejs/、cpp/tutorials/
packages/                   # npm配布定義。virtual-filesは独立した実装も持つ
docs/                       # 公開サイト、解説、設計・検証記録
assets/                     # 自作の音声素材・生成コードとライセンス
test/                       # runtime/への277件分離済み。fixture、helperも管理
scripts/                    # build・同期・配布・検証の入口
third_party/                # 固定SDK、第三者ソース、出典・ライセンス
```

`runtime/`はブラウザー専用という意味ではない。現在の`web/`には、Nodeでも使う低レベル音源とファイル形式の処理が含まれる。`node/`はNode向けの出力・実行アダプターとして分ける。

`src/`にはTetorica独自の`chip_state.h`とSega PSG互換入口もあるが、現在のコア・教材との関係を維持する。`src/reference/`への移動案はユーザー指定により取り下げた。通常のチップビルドが参照する正本は、引き続き`third_party/tetorica-soundchip-native/`。

## 移行開始時の配置と移動先

| 現在 | 追跡ファイル数 | 移動先・扱い |
| --- | ---: | --- |
| `web/` | 730 | テスト277件は`test/runtime/`へ分離済み。残る実装と生成物は`tetorica_src/runtime/`へ |
| `node/` | 7 | `tetorica_src/node/` |
| `cli/` | 4 | `tetorica_src/cli/` |
| `native/` | 13 | `tetorica_src/native/`。独自の`audio_effect/`が対象 |
| `src/` | 25 | 現在の配置を維持 |
| `wasm/` | 28 | `tetorica_src/wasm/` |
| `demos/` | 2 | `sound-color/`を`tetorica_examples/nodejs/sound-color/`へ統合済み |
| `tutorials/` | 6 | C++3件は`tetorica_examples/cpp/tutorials/`、解説3件は`docs/tutorials/`へ統合済み |
| `examples/` | 39 | 上流由来の2例を元の場所へ復元。独自のNode/Browser例は`tetorica_examples/`へ分離済み |
| `assets/` | 4 | 維持。OPNAリズムの自作生成コードとBSDライセンス |
| `packages/` | 40 | 維持。配布パスと編集元の配置を区別 |
| `docs/` | 2,495 | 維持。公開コピー・編集元・記録の区別を段階的に明示 |
| `scripts/` | 394 | 維持。内部はbuild/package/check等へ後から整理可能 |
| `test/` | 291 | 維持。`web/`から分離するテストを`test/runtime/`へ集約する案 |
| `third_party/` | 580 | 維持。固定SDK snapshotの内部は移動しない |

件数は調査時点の`git ls-files`による。隠し設定フォルダーとローカル生成物は上記15件に含めない。

## 移行TODO

- [x] 全直下フォルダーを、管理対象のソース・教材・公開物・ローカル作業領域に分類する。
- [x] CLI／Node／共有runtimeの役割、通常ビルドと旧C++比較入力を区別する。
- [x] ユーザーの追加指定を反映し、ymfmの`src/`・`examples/`を維持する。独自追加の移動先を`tetorica_src/`・`tetorica_examples/`に更新する。
- [x] `demos/`とTetorica独自のC++・Node・Browser利用例を`tetorica_examples/`へ集め、上流の`examples/buildall/`・`examples/vgmrender/`を元の位置へ戻す。
- [x] `tutorials/`の英日`ex00`を`docs/tutorials/`の版と比較し、双方の内容を保持して統合する。他の4件はバイト一致を確認済み。公開教材へのリンクも確認する。
- [x] web直下のテスト277件を`test/runtime/`へ分離する。CI、npm scripts、fixture、動的import、型検証も更新する。
- [x] `wasm/`と`native/`を`tetorica_src/`配下へ移し、比較ビルド・教材・Native FXの出力とsource bundleを検証する。
- [x] `cli/`と`node/`を`tetorica_src/`配下へ移し、入口・version取得・Worker URL・配布時のパス変換を更新する。
- [x] `web/`を`tetorica_src/runtime/`へ移す。WASM探索・manifest・builder・同期・配布・型生成・Tauri側の参照を一度に更新し、生成物の正本を一つに保つ。
- [x] 英日README、AI引継ぎ、source guide、build／release案内を実際の配置へ更新する。
- [x] npmを実インストールしたPCM・型検証、itch ZIPの依存／source／licenseを確認する。
- [x] ブラウザーのMain／Worker／Worklet検証を完了する。追加検証の結果は下記に記録。

各段階を独立して検証・再開できる単位にする。ソースの移動にDSP計算・ゲイン変更を混ぜず、移動前後のファイル内容とPCMを比較する。過去の測定報告は歴史的記録として残し、校正の参照パス変更は現行チェックで検証する。

## 第1段階の実装・検証記録

- `demos/sound-color/`を`examples/nodejs/sound-color/`へ、既存の`buildall/`と`vgmrender/`および3件のC++教材を`examples/cpp/`へ移した。空になったルートの`demos/`と`tutorials/`を除き、管理対象の直下フォルダーは15件から13件になった。
- `docs/tutorials/`をMarkdownの正本とした。旧`ex00`内のbeep説明は既存`ex03`と照合し、欠けていた手順・reset説明・練習の問いを取り込んだ。VGMノート、inflater本体・ライセンス通知はバイト一致を維持した。
- C++の編集元は`examples/cpp/tutorials/`とし、`docs/tutorials/*.cpp`の公開URLを維持。`scripts/sync_tutorial_sources.mjs`でコピーと書き込みなしの`--check`を提供し、Web同期・CIへ接続した。`npm run sync:tutorials`／`npm run check:tutorials`でも実行可能。
- Nodeの旧デモにあったフレーム数未指定を修正し、実WASMで128フレームの有限なSine PCMを生成・disposeした。READMEの存在しないpreset importを修正し、共通WAV encoderを使う例も実行。53,267 Hzの16 bit stereo WAV 319,648 bytesを生成できた。別のカレントディレクトリーからの実行も成功。
- C++は3教材・buildall・vgmrenderの計5件を実コンパイルして実行。合成VGMとVGZのレンダリングも成功。beep教材はNativeとEmscripten/WASMの両方で3秒・159,801 stereo framesを生成した。
- beep教材が表示とは異なるWAV名を生成する既存問題は、`wav.set_index(0)`で出力名を`wavlog-00.wav`へ固定した。Native／WASMのPCMは変更前後で一致し、PCM SHA-256は`2b93a11176a7a74a2fe3835eebc57dd305897ad29c0e05046f98c9b0ccc70259`。
- 公開デモのGitHubソース参照、READMEの利用例入口、出典の対象ディレクトリー、AI引継ぎも更新。ローカル文書リンク192件、公開C++コピー3件を確認し、英日Goalの既存4項目も完全一致を確認した。
- 共通artifact checkは引き続き33 SDK builds／66 outputs／73 mirrorsで成功。音源コア、WASMブリッジ、公開JS／WASM、固定SDKには変更を加えていない。`git diff --check`成功。
- C++コンパイルには既存の警告が残る。macOSのvgmrenderの`sprintf`非推奨警告、Emscriptenでのローカル比較コア`src/ymfm_fm.ipp`の配列境界警告を確認した。今回コアの変更は行っていない。

上記は最初の教材統合時点の記録。その後のユーザー指定に合わせ、上流の2例を`examples/`直下へ戻し、独自例を`tetorica_examples/`へ分離した。現在の教材編集元は`tetorica_examples/cpp/tutorials/`。変更後も公開コピー3件、C++5プログラムとNode例の実行を確認した。

## 第2段階のテスト分離と追加指定の反映

- `src/`25件を維持し、上流由来の`examples/buildall/`・`examples/vgmrender/`を復元。独自例は`tetorica_examples/`へ集約し、CI・利用手順・公開教材の編集元・出典を更新した。
- web直下の276 `.test.mjs`とSCSP型テスト1件を`test/runtime/`へ移し、直下のファイル数は632件から355件になった。
- module lexerで相対import／動的template import 1,305件を移行。source／fixture／Worker URLはruntimeディレクトリーを明示した基準から解決し、検証対象文字列とassertionを保持した。移動処理を逆にたどる比較で全277件の本文と参照先の一致を確認した。
- `web/spc_test_fixture.mjs`と`web/native_genesis_extra_creation_fixture.mjs`は既存の共有・校正入力として維持。実装／公開物／固定SDKの1,570ファイルは移動開始前とバイト一致し、web/READMEだけ案内を更新した。
- `npm run test:runtime`・`test:runtime:types`を追加。`npm test`もrootとruntimeの両方を対象とし、`test:analyzer`・`test:cdrom2`・mock runner・3 workflowの実行／起動条件・現行文書の参照を更新した。
- runtime全体は移動前後とも3,728件中3,726件成功、失敗2件も一致。SCSPソース型検証とmock runner 185件は成功。CIが参照する62テスト・12コマンドのパス／Shell構文、3 workflowのYAMLも確認済み。
- rootを含む`npm test`は4,197件中4,194件成功。下記の既存失敗3件を確認した。移動による新規失敗はない。
- 教材コピーと全生成物の検証は継続して成功。音源実装、ゲイン、固定SDK、過去の測定報告を変更していない。

移設時点で残っていた課題（下記の修正で解消）：

- [x] `test/runtime/native_runtime_synth.test.mjs`：SCSP停止後の状態を借用クライアントへ渡す際、非発音の`null`が440 Hz／LFO／変調の既定値へ変換される。`tetorica_src/runtime/scspsynth.js`の`_adoptState`でinactive値の保持を検討する。今回assertionは弱めていない。
- [x] `test/runtime/playground_megacd_default.test.mjs`：現行starterが参照する`cdda`がテスト実行環境に渡されていない。移動前から`ReferenceError: cdda is not defined`で失敗する。
- [x] `test/wonderswan-analyzer.test.mjs:32`：現行の測定済みGain 1.172528に対し、古い固定期待値1をassertする。テスト本体とpresetは今回の移行前から未変更。

### 既存失敗3件の修正（2026-11-04 完了）

- [x] SCSP：停止済みslotの明示的な`null`を状態の受け渡しで保持する。発音中の値と旧形式の省略値の扱いも確認し、必要な回帰検証と公開runtimeへの反映を行う。
- [x] Mega CD：starterが使う`cdda`を実際のAPIに沿ってテスト環境へ提供し、既存のPCM音程・無音gate・クリック負例の検証を維持する。
- [x] WonderSwan：固定gain=1という古い期待値を測定済み既定値を確認する検証へ更新し、mute／seek／master gainの実WASM検証を維持する。
- [x] PS1／WonderSwan／POKEY／SCSPの現行公開runtimeを完全matrixで再測定し、`*_state_restore_chip_levels_01.json`として追加する。旧reportの測定・SHAを保持し、新reportのraw source一致からpolicyを再生成する。SCSPは新baselineで`--verify`も完走させる。
- [x] 関連テスト・校正／同期・全体`npm test`を確認し、既存3件を含めて全件成功を確認する。

今回の修正・検証結果：

- SCSPの`_adoptState`と`_adoptEditorState`が、停止済みを表す明示的な`null`を保持する。旧形式で省略された値だけは従来のpresetへfallbackする。発音中／release中の保持値、snapshotのコピー所有、RAM／nativeFramesを操作しない受け渡しを実WASMで回帰検証した。
- Mega CDのstarter用テストを現行の8音フレーズ・PSG・実CD-DA offline rendererへ対応。PCMの音程・headroom・無音gate・旧クリックの負例を維持し、CD-DAの4秒stereo出力・完走・次フレーズでの全sample一致まで確認した。
- WonderSwanの既定gain期待を新しい実測reportのvalidatorから導出し、実WASMで絶対指定gain=1のPCMへ既定gainが左右とも一度だけ適用されることを追加確認した。mute／seek／Stop／混合／master／WAV検証も維持した。
- SCSPは他チップの校正でも読み込む共有runtimeのため、4系統を現在のsourceで完全再測定した。旧report／旧SHA／歴史的測定は維持。新reportでは全script・served sourceをraw SHAで照合し、古いreportは意味変更を検出してstaleとして拒否する。SCSPのscript provenanceは旧2keyか新2keyの完全な一方だけを認め、混在・欠落・別名併記を拒否する。

| 新しい記録 | 結果 |
| --- | --- |
| [PS1](ps1_state_restore_chip_levels_01.json) | 48 PS1＋8 YM2612。全経路成功 |
| [WonderSwan](wonderswan_state_restore_chip_levels_01.json) | 48 WonderSwan＋8 YM2612。全経路成功 |
| [POKEY](pokey_state_restore_chip_levels_01.json) | 96 POKEY＋8 YM2612＋8 PSG＋8 Dual組合せ。全経路成功 |
| [SCSP](scsp_state_restore_chip_levels_01.json) | 48 SCSP＋8 YM2612。全経路成功 |
| [SCSP生成policyの確認](scsp_state_restore_chip_levels_verify_01.json) | 新baseline／既定gainによる48 SCSP＋8 YM2612。全経路成功 |

- 全てChromium／WebKit、44.1／48kHz、Main／Workerを含む完全matrixで、物理出力を無音にして測定。独立pilotによるPCM連続性、Stop後の零出力を確認し、clock診断の異常は0件だった。
- 再測定から両generatorを再実行し、`--check`も成功。PS1のprimary／extra 0.129331、WonderSwan 1.172528は維持。POKEYのprimary／extraは0.413052→0.413029、Dual各0.413051→0.413028、SCSP primaryは0.128825→0.128826へ微調整（最大相対差約0.006%）。SCSP extraは0.128826を維持。共通target amplitudeは変更していない。
- `npm test`は**4,200件すべて成功、失敗・skipとも0**。追加した回帰3件を含む。関連130件、SCSPソース型検証、校正・生成器・改変拒否・歴史保持の545件も成功。
- npm buildは345 modules／28 engine pairs／396 declarations。ローカルの実tarballをinstallして全28 WASM・15 renderers・PCM・NodeNext／Bundler／Browser型・source／license／receiptを検証した。
- Playground／Analyzer／Synthの実ZIP作成・依存・source／license・全CRC確認が成功。最新のSCSP／生成policyの同梱を確認し、Playground再生成対象11ファイルも実行前後で完全一致した。
- GitHub Actionsの現行report参照とSCSP新provenance／状態復元／`--verify`を更新した。Actionsのリモート実行・公開・commit／pushは行っていない。

独自実装の移動は下記第3段階で完了した。ymfm由来の`src/`・`examples/`は維持している。

## 第3段階の実装移動（2026-11-04）

- `web/`・`node/`・`cli/`・`native/`・`wasm/`をそれぞれ`tetorica_src/runtime/`・`node/`・`cli/`・`native/`・`wasm/`へ移した。旧ルートの5フォルダーと互換symlinkは残していない。管理対象の直下は10フォルダーになった。
- [ソース全体の入口](../../tetorica_src/README.md)を追加。英日README、共有runtime／Nodeガイド、CLI、build／release、AI引継ぎ、利用例を更新。34文書の相対リンク425件とanchor 33件を確認し、README Goalの既存4項目は完全一致を維持した。
- 相対import・Worker／Worklet・fixture・JSDoc・URL・CLIのversion取得を移行。npm／ZIPの配置は配布境界で変換し、既存の公開import、installed `cli/`・`node/`・`web/`と公開サイトURLを維持する。
- 33 SDK build wrapper、Native FX、旧OPN比較ビルド、artifact manager／profile、型生成、source bundle、同期、校正、CIの参照を更新した。正本は`tetorica_src/runtime/generated/`一つ。manifest 2件の編集元パスを更新し、33 SDK builds／66 outputs／73 mirrorsの検証に成功した。
- 過去の校正レポートは変更せず、移設された入力だけを厳密に旧配置へ正規化して元のSHA-256を確認する。SCSP／PSG／AnalyzerにはDSPを1 byte変更した場合などの拒否テストも追加。Analyzer NES／Extra／PSGの再測定はsource記録以外の全JSONが過去reportと一致した。
- `npm run build:fm2612`・`build:vgm`が成功。FM npm tarballを実インストールし、28 WASM engines、15 chip renderers、PCM、source／license、NodeNext／Bundler／Browser型検証が成功した。VGMもローカルtarballをオフライン実インストールし、168 modules、SPC解析・音程・MIDI／MusicXML／LilyPond・CLI・VGM／S98回帰検査が成功した。ソースの`createSoundChip`でも全21対象を既定のローカルWASM探索で作成し、128 stereo framesの有限なPCMを確認した。
- 実Playground／Analyzer／Synth ZIPを作成し、依存・source／license・CRCを確認。Playground for_run ZIPは968 entriesで1000以下。SPU／SCSPの個別ZIPはfixtureで正本一致・再現性・自己完結性を確認した。
- artifact／配布境界の29テスト、recording compilerを使うPython 118件とSDK hash検証が成功。実WASMの全件再コンパイルは行っていない。`test:runtime:types`も成功。全体`npm test`は移行前と同じ4,197件中4,194件成功・既存失敗3件で、新規失敗はない。校正関連293件も成功した。
- 移行開始前の`src/`25件・`examples/`6件、公開`docs/js/`404件と`docs/generated/`のWASM／loader／build receiptはすべてバイト一致。固定SDKも変更していない。公開JSコピーを一括再生成して変更を混ぜることはしていない。
- `sync_web_js_to_docs.sh`を使い、移設後のソースと移設前HEADのソースを別々の一時コピーへ同期した。`docs/`全2,499ファイルの出力hashが完全一致し、配布境界の変換を含め同期の回帰がないことを確認した。実リポジトリの公開コピーは変更していない。
- ローカル別repo `w/tetorica-fm2612-playground-tauri`の親ソースを読むscripts／testsも新旧配置に対応させた。履歴のsnapshot key・pins・SDK・UI・`src-tauri/`・配布物は保持し、Python 36件・JS 33件・オフラインsnapshot 24件、FX 42ケース（差最大1.49e-8）・Noise 54ケース（差0）が成功。この別repoにも未コミット変更がある。SPU Tauriは変更していない。

### 追加ブラウザー検証（2026-11-04 完了）

- [x] `node scripts/check_megacd_browser.cjs`：固定の壁時計120msではなく、AudioContextの時間が2つの新しいAnalyser window分進み、期待する左右の出力を得るまで最大5秒待つ検査へ変更した。出力／漏れの閾値は維持。8chのPCM・左右pan・keyOff・FM／PSG／PCM混合・reset後のRAM保持・close／restart・Playground Workerが成功した。失敗時には左右の値、contextの時間と状態、Mixerを記録する。
- [x] `node scripts/check_megasynth_offline_browser.cjs`：権限付きでlocalhostサーバーを起動して完了。Node、Browser Main、実Native FX AudioWorkletのstereo PCMが4,096 framesすべて完全一致し、WASM探索・event clock・Delay／Reverbを確認した。配列長・有限値・非ゼロの確認、実行期限、通信／processorerror捕捉、終了処理も追加した。
- [x] `node scripts/check_ps1_spu_browser.cjs --chromium --webkit`：移設したPS1 SPUのsourceをChromium／WebKitのWindow／DedicatedWorkerで実行し、実Node WASMとPCM完全一致。24番目のvoice、44.1kHz、RAMのコピー所有・独立instance、pitch／stereo／reset／disposeの制御が全4経路で成功した。
- 初回のMega CD失敗は0/0だったが、同じサンプルを実WASMと実Worklet／RPC経由で8ch再生でき、診断のみを加えた別のブラウザー実行でも成功した。音源やWASMは変更せず、実時間計測の待ち方を修正して再検証した。
- `npm run test:fm2612:browser`にOffline／AudioWorklet検証も接続した。検証script 2件、npm command、今回の記録のみを変更し、公開JS／WASM・校正値・既存の3件の別課題は変更していない。

## 維持する公開・配布の契約

- npmの公開import、`cli/main.js`、`node/*`、平坦な音源モジュールと生成物の配置を維持する。編集元のディレクトリー変更を利用者のAPI変更にしない。
- 公開サイトの`/playground/`、`/synth/`、`/synth-spu/`、`/synth-scsp/`、`/vgm_analyzer/`、`/js/`、`/generated/`、`/sources/`、`/licenses/`を維持する。
- `soundchip.js`、`nesapu_wasm.js`、`pwm32x_wasm.js`の編集元では`./generated/`から探索する。公開コピーとnpm／ZIPの配置への変換は配布境界で行い、既存の公開JSの内容も維持する。
- artifact manager／catalog／profile／builderと検証を移設に合わせて更新した。現在の正本は`tetorica_src/runtime/generated/`一つとし、`docs/generated/`を公開コピーとして維持する。
- 固定SDKのsource manifest、第三者ライセンス、配布する対応ソースと再ビルド手順を保持する。

## docsとローカル作業領域

`docs/`には公開アプリの編集元、共有runtimeの公開コピー、一部独立実装、教材、開発記録が同居する。現在はサイトとして使われるパスなので、単純な一括改名は行わない。将来アプリの編集元を分離する場合は、共有解析をCLIと共有できる構造にしてから、manifestで現在の公開URLへ配置する。現段階では`apps/`を追加せず、source／copyの境界を先に明確にする。

`docs/playground/examples/`の127例はアプリ内で実行するコードで、一般API利用例の`examples/`とは実行環境が異なる。アプリ側で管理する。`docs/sources/`と`docs/licenses/`も配布用の対応ソース・通知として保つ。

`w/`、`ww/`、`www/`、`build/`、`dist/`、`release/`と`node_modules/`はすべて追跡0件でignore済み。ローカルの表示には並ぶが、リポジトリー構成とは別の作業領域。

- `w/`は独立したGitリポジトリー群。Tauri／Plugin等を親の`src/`へ取り込まない。スクリプト約40件が現在の場所を参照するため、移動前に設定化が必要。
- `ww/`はゲーム音楽等の検証資料、`www/`はCassette等の作業データ。削除・公開・一括移動の対象にしない。
- `dist/`はnpm配置、`release/`はZIPと配布stage、`build/`は一時出力。将来まとめる場合も、出力先の設定化と配布コマンドの整合性を先に扱う。
