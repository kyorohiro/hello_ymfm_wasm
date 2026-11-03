# リポジトリー直下のフォルダー整理

2026-11-03。ユーザーの「cli...webまで、直下のFolderが雑然としている」を受けた調査・配置案。同日の「進めて」を受け、教材・利用例の整理とテスト分離を実装した。追加指定「src/、examples/はymfm由来だからそのまま」「tetorica_src、tetorica_examplesにまとめますか」を優先し、上流と独自追加を分ける方針へ更新した。`web/`、`cli/`、`node/`等の実装移動は次段階。

関連：[web/と生成物の整理](todo_web_organization_01.md)、[現在のソース案内](../../web/README.md)。Tetoricaの既存4つのGoalを維持する。

## 目指す配置

ymfm由来の`src/`・`examples/`は元の配置で維持する。Tetorica独自実装は`tetorica_src/`、独自の利用例は`tetorica_examples/`へまとめる。フォルダー数を一律に減らすより、由来と編集場所を明確にする。最終的な管理対象の直下は下記10フォルダーの案。

```text
src/                        # ymfm由来。現在の配置を維持
examples/                   # ymfm由来のbuildall/・vgmrender/を維持
tetorica_src/
  runtime/                  # 現web/。Browser/Node共通の音源JS、Synth、Worklet等
    generated/              # 全WASM・loader・metadataの正本
  node/                     # Node音声出力・Workerアダプター
  cli/                      # VGM CLI / Node解析APIの入口
  native/                   # Tetorica独自のNative FX
  wasm/                     # 現wasm/。独自ブリッジと比較検証用のビルド入力
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
- [ ] `wasm/`と`native/`を`tetorica_src/`配下へ移し、比較ビルド・教材・Native FXの出力とsource bundleを検証する。
- [ ] `cli/`と`node/`を`tetorica_src/`配下へ移し、入口・version取得・Worker URL・配布時のパス変換を更新する。
- [ ] `web/`を`tetorica_src/runtime/`へ移す。WASM探索・manifest・builder・同期・配布・型生成・Tauri側の参照を一度に更新し、生成物の正本を一つに保つ。
- [ ] 英日README、AI引継ぎ、source guide、build／release案内を実際の配置へ更新する。
- [ ] npmを実インストールしたPCM・型検証、itch ZIPの依存／source／license検証、ブラウザーのMain／Worker／Workletを確認する。

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

別途修正する既存テスト／状態復元の課題：

- [ ] `test/runtime/native_runtime_synth.test.mjs`：SCSP停止後の状態を借用クライアントへ渡す際、非発音の`null`が440 Hz／LFO／変調の既定値へ変換される。`web/scspsynth.js`の`_adoptState`でinactive値の保持を検討する。今回assertionは弱めていない。
- [ ] `test/runtime/playground_megacd_default.test.mjs`：現行starterが参照する`cdda`がテスト実行環境に渡されていない。移動前から`ReferenceError: cdda is not defined`で失敗する。
- [ ] `test/wonderswan-analyzer.test.mjs:32`：現行の測定済みGain 1.172528に対し、古い固定期待値1をassertする。テスト本体とpresetは今回の移行前から未変更。

次は独自実装の`tetorica_src/`への移動。ymfm由来の`src/`・`examples/`を維持したまま進める。

## 維持する公開・配布の契約

- npmの公開import、`cli/main.js`、`node/*`、平坦な音源モジュールと生成物の配置を維持する。編集元のディレクトリー変更を利用者のAPI変更にしない。
- 公開サイトの`/playground/`、`/synth/`、`/synth-spu/`、`/synth-scsp/`、`/vgm_analyzer/`、`/js/`、`/generated/`、`/sources/`、`/licenses/`を維持する。
- `soundchip.js`、`nesapu_wasm.js`、`pwm32x_wasm.js`の`/web/`文字列判定と、配布時の書き換えを同時に整理する。ファイル移動だけではWASM探索が壊れる。
- `web/generated/`を移すときは、先に実装したartifact manager／catalog／profile／builderと検証も更新する。移行完了後の正本は`tetorica_src/runtime/generated/`一つとし、`docs/generated/`を公開コピーとして維持する。
- 固定SDKのsource manifest、第三者ライセンス、配布する対応ソースと再ビルド手順を保持する。

## docsとローカル作業領域

`docs/`には公開アプリの編集元、共有runtimeの公開コピー、一部独立実装、教材、開発記録が同居する。現在はサイトとして使われるパスなので、単純な一括改名は行わない。将来アプリの編集元を分離する場合は、共有解析をCLIと共有できる構造にしてから、manifestで現在の公開URLへ配置する。現段階では`apps/`を追加せず、source／copyの境界を先に明確にする。

`docs/playground/examples/`の127例はアプリ内で実行するコードで、一般API利用例の`examples/`とは実行環境が異なる。アプリ側で管理する。`docs/sources/`と`docs/licenses/`も配布用の対応ソース・通知として保つ。

`w/`、`ww/`、`www/`、`build/`、`dist/`、`release/`と`node_modules/`はすべて追跡0件でignore済み。ローカルの表示には並ぶが、リポジトリー構成とは別の作業領域。

- `w/`は独立したGitリポジトリー群。Tauri／Plugin等を親の`src/`へ取り込まない。スクリプト約40件が現在の場所を参照するため、移動前に設定化が必要。
- `ww/`はゲーム音楽等の検証資料、`www/`はCassette等の作業データ。削除・公開・一括移動の対象にしない。
- `dist/`はnpm配置、`release/`はZIPと配布stage、`build/`は一時出力。将来まとめる場合も、出力先の設定化と配布コマンドの整合性を先に扱う。
