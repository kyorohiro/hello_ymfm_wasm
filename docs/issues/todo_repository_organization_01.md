# リポジトリー直下のフォルダー整理

2026-11-03。ユーザーの「cli...webまで、直下のFolderが雑然としている」を受けた調査・配置案。同日の「進めて」を受け、段階的な移行を開始した。第1段階の教材・利用例統合を完了。残るソース移動は下記TODOの通りで、`web/`、`cli/`、`node/`等はまだ現在の場所にある。

関連：[web/と生成物の整理](todo_web_organization_01.md)、[現在のソース案内](../../web/README.md)。Tetoricaの既存4つのGoalを維持する。

## 目指す配置

共有実装は`src/`、配布定義は`packages/`、教材は`examples/`、公開サイトと文書は`docs/`へ集める。現在Gitで管理する直下15フォルダーを、下記8フォルダーへ整理する案。

```text
src/
  runtime/                  # 現web/。Browser/Node共通の音源JS、Synth、Worklet等
    generated/              # 全WASM・loader・metadataの正本
  node/                     # Node音声出力・Workerアダプター
  cli/                      # VGM CLI / Node解析APIの入口
  native/                   # Tetorica独自のNative FX
  reference/
    local-cores/            # 現src/。比較検証・教材が使う旧ローカルコア
    wasm/                   # 現wasm/。対応する比較用WASMブリッジ
packages/                   # npm配布定義。virtual-filesは独立した実装も持つ
docs/                       # 公開サイト、解説、設計・検証記録
examples/                   # browser/、nodejs/、cpp/ の利用例
assets/                     # 自作の音声素材・生成コードとライセンス
test/                       # 共有テスト、fixture、helper
scripts/                    # build・同期・配布・検証の入口
third_party/                # 固定SDK、第三者ソース、出典・ライセンス
```

`runtime/`はブラウザー専用という意味ではない。現在の`web/`には、Nodeでも使う低レベル音源とファイル形式の処理が含まれる。`node/`はNode向けの出力・実行アダプターとして分ける。

既存の`src/`にはymfmだけでなくTetorica独自の`chip_state.h`とSega PSG互換入口もあるため、移動先を`reference/ymfm/`とはしない。比較検証・C++教材で現在も使う入力として残す。通常のチップビルドが参照する正本は、引き続き`third_party/tetorica-soundchip-native/`。

## 移行開始時の配置と移動先

| 現在 | 追跡ファイル数 | 移動先・扱い |
| --- | ---: | --- |
| `web/` | 730 | `src/runtime/`。生成物の正本も同時に移行 |
| `node/` | 7 | `src/node/` |
| `cli/` | 4 | `src/cli/` |
| `native/` | 13 | `src/native/`。独自の`audio_effect/`が対象 |
| 現在の`src/` | 25 | `src/reference/local-cores/` |
| `wasm/` | 28 | `src/reference/wasm/` |
| `demos/` | 2 | `sound-color/`を`examples/nodejs/sound-color/`へ |
| `tutorials/` | 6 | C++3件を`examples/cpp/tutorials/`、解説3件を`docs/tutorials/`へ統合 |
| `examples/` | 39 | 既存Node/Browser例を保ち、`buildall/`と`vgmrender/`を`cpp/`配下へ |
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
- [x] 一つの`src/`へ集める全体案と移行時の制約を記録する。
- [x] `demos/`とC++利用例を`examples/`へ集め、実行入口・相対import・build script・説明リンクを更新する。
- [x] `tutorials/`の英日`ex00`を`docs/tutorials/`の版と比較し、双方の内容を保持して統合する。他の4件はバイト一致を確認済み。公開教材へのリンクも確認する。
- [ ] web直下のテスト277件を`test/runtime/`へ分離する。従来案の`test/web/`は、上記配置を採用する場合に読み替える。CI、npm scripts、fixture、動的importも更新する。
- [ ] 既存`src/`の25件を`src/reference/local-cores/`へ移し、新しい共有実装用`src/`を用意する。`.gitignore`の非anchoredな`reference/`ルールを限定し、移動先が追跡対象になることを確認する。
- [ ] `wasm/`と`native/`を対応する`src/`配下へ移し、比較ビルド・教材・Native FXの出力とsource bundleを検証する。
- [ ] `cli/`と`node/`を移し、入口・version取得・Worker URL・配布時のパス変換を更新する。
- [ ] `web/`を`src/runtime/`へ移す。WASM探索・manifest・builder・同期・配布・型生成・Tauri側の参照を一度に更新し、生成物の正本を一つに保つ。
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

次の段階はweb直下のテストを`test/runtime/`へ分離すること。その後に、比較用C++と共有実装の`src/`配下への移動を進める。

## 維持する公開・配布の契約

- npmの公開import、`cli/main.js`、`node/*`、平坦な音源モジュールと生成物の配置を維持する。編集元のディレクトリー変更を利用者のAPI変更にしない。
- 公開サイトの`/playground/`、`/synth/`、`/synth-spu/`、`/synth-scsp/`、`/vgm_analyzer/`、`/js/`、`/generated/`、`/sources/`、`/licenses/`を維持する。
- `soundchip.js`、`nesapu_wasm.js`、`pwm32x_wasm.js`の`/web/`文字列判定と、配布時の書き換えを同時に整理する。ファイル移動だけではWASM探索が壊れる。
- `web/generated/`を移すときは、先に実装したartifact manager／catalog／profile／builderと検証も更新する。移行完了後の正本は`src/runtime/generated/`一つとし、`docs/generated/`を公開コピーとして維持する。
- 固定SDKのsource manifest、第三者ライセンス、配布する対応ソースと再ビルド手順を保持する。

## docsとローカル作業領域

`docs/`には公開アプリの編集元、共有runtimeの公開コピー、一部独立実装、教材、開発記録が同居する。現在はサイトとして使われるパスなので、単純な一括改名は行わない。将来アプリの編集元を分離する場合は、共有解析をCLIと共有できる構造にしてから、manifestで現在の公開URLへ配置する。現段階では`apps/`を追加せず、source／copyの境界を先に明確にする。

`docs/playground/examples/`の127例はアプリ内で実行するコードで、一般API利用例の`examples/`とは実行環境が異なる。アプリ側で管理する。`docs/sources/`と`docs/licenses/`も配布用の対応ソース・通知として保つ。

`w/`、`ww/`、`www/`、`build/`、`dist/`、`release/`と`node_modules/`はすべて追跡0件でignore済み。ローカルの表示には並ぶが、リポジトリー構成とは別の作業領域。

- `w/`は独立したGitリポジトリー群。Tauri／Plugin等を親の`src/`へ取り込まない。スクリプト約40件が現在の場所を参照するため、移動前に設定化が必要。
- `ww/`はゲーム音楽等の検証資料、`www/`はCassette等の作業データ。削除・公開・一括移動の対象にしない。
- `dist/`はnpm配置、`release/`はZIPと配布stage、`build/`は一時出力。将来まとめる場合も、出力先の設定化と配布コマンドの整合性を先に扱う。
