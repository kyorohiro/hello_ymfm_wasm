# Analyzer CLI 第2段階: Browserとの機能差を順番に埋める

## 目的

Browser版で利用できる解析・変換機能を、CLI / Node APIからも利用できるようにする。
第1段階は [analyzer_cli_01.md](analyzer_cli_01.md)、現在の仕様は [CLI.md](../../CLI.md) を参照。

このファイルは作業計画。以下の未完了項目はまだ実装済みではない。
各番号を実装・検証・ドキュメント更新まで含む作業単位とし、原則として番号順に進める。
大きい項目は音源・形式ごとに分けて完了させる。

## 共通方針・完了条件

- Browserの既存処理を共有し、CLI専用に解析・音源処理をコピーしない。
- Browser / CLI / Node API / 将来のMCPから共通利用できるCoreとして、音源選択・生成・renderingのinterfaceを整える。
- Browser用engineとCLI用engineを別々に増やさず、chip固有の生成・PCM rendering処理を共有する。
- CoreはDOM、WebAudio、Node filesystem、stdout / stderrに依存しない。
- WASM・ROMの取得と環境固有のローダー設定はadapterの責務とし、Coreへfactoryやバイト列を渡す。Coreは取得先URLやファイルパスを決めない。
- BrowserはWebAudio等へのadapter、CLIはWAV / file等へのadapterとして扱う。Node固有のファイル操作・引数処理はCLI側に置く。
- CoreMIDI / CoreAudio等、今回と無関係な別projectの概念は持ち込まない。
- Browserの既存対応範囲を基準とし、未対応音源の新規エミュレーションは対象外。
- 各作業でCLIとNode APIの両方を確認し、対応範囲と制限をCLI.md / helpに反映する。
- 音源追加は初期化だけでなく、自作fixtureで発音・PCM転送・組み合わせの拒否を検証する。
- 必要な回帰テストを実行し、`npm run build`でユーザーが実行するdistも更新する。
- 配布依存が増えた作業ではtarballの内容・ライセンス同梱・別ディレクトリへのインストールを確認する。
- ROM・ゲームファイル・Browser UI資産・LilyPond runtimeをnpm配布に混入させない。
- npm publishは本TODOの実装完了とは別作業とする。

## 現在の到達点

- [x] VGM/VGZのanalyze、7形式のexport、限定した音源のWAV render。
- [x] Browserと共有するCore、Node API、npm配布用のビルド。
- [x] YM2612 + RF5C164 + 任意のSega PSGのCLI render。PCM発音・tarball・実曲で確認済み。

## TODO

### 01. 対応表と音源選択の整理

独立した設計・リファクタリング工程として実施する。単にBrowserの各音源をCLIへ個別に移植する工程にはしない。
まず既存実装を調査し、下記の責務分離を基準として、現在の構造に自然なinterfaceを設計する。

```text
VGM/VGZ
   ↓
source / parser
   ↓
chip configuration
   ↓
shared engine selection / creation ← adapterからfactory・ROM bytesを提供
   ↓
shared render core
   ↓
PCM
   ├─ Browser → WebAudio
   └─ Node/CLI → WAV / file
```

#### 01a. 現状調査と対応表

- [x] BrowserとCLIで、構成判定・engine選択・engine生成・PCM renderingがどこで分岐・重複しているか記録する。
- [x] Browserが実際に対応する音源・複合構成・必要ROM・variant / dualフラグを調べ、CLIとの差を対応表にする。
- [x] 環境非依存の処理と、UI・WebAudio・ファイル取得等のadapter処理を区別し、移動先と依存方向を記録する。

#### 01b. 共通interfaceの設計と実装

- [x] 構成判定、engine選択・生成、PCM renderingのうち環境非依存の部分をCoreへ寄せる。
- [x] WASM factory・ROM bytes等の資源をadapterから渡すinterfaceを定義する。
- [x] 共通の構成判定・選択・生成経路をBrowserとCLI / Node APIが実際に利用する。interfaceだけ追加し、Browserの重複分岐をそのまま残して完了にしない。
- [x] variant、dual chip、複合音源、外部ROMの条件を一箇所で扱えるようにし、環境ごとの例外的なif / switchを増やさない。
- [x] 現在Browserが扱う構成を基準にし、不要な汎用plugin機構等の過度な抽象化を避ける。
- [x] 「音源構成が未対応」と「対応する構成だがfactory / ROM等が不足」を区別する。検出構成・不足資源を機械的に扱える診断として返し、表示やstderr出力はadapterが行う。
- [x] PCMのサンプルレート・チャンネル・ブロックの扱い、終了・reset・dispose、初期化失敗時の解放を既存engineに沿って明確にする。

#### 01c. 検証

- [x] Coreのimportと利用にDOM / WebAudio / Node filesystem等の環境依存が不要であることを確認する。
- [x] 同じ入力・設定・音源実装を使い、Browser経路とCLI経路のWebAudio接続前 / WAV符号化前のPCMが一致することを自作fixtureで検証する。初期化成功だけで完了にしない。
- [x] 比較条件（クロック、ROM、ミュート、音量、ループ、サンプルレート等）を揃え、一致基準を記録する。
- [x] FM / PSG / PCMを含む既存対応構成、未対応構成、資源不足の診断を検証する。未対応音源を黙って除外しない。
- [ ] 実ブラウザの画面で再生・WAV出力・モニターを確認する。接続可能なブラウザがなく未確認。Browser初期化関数のVM検証とCLI / Node API・関連回帰テストは実施済み。
- [x] distを更新し、配布物からのCLI / Node API実行と依存・ライセンスの境界を確認する。

#### 01d. 後続工程へ進む条件

- [x] YM2203 / YM2608 / YM2610(B)を例に、共通interface上で追加する箇所と必要資源を説明できる。
- [x] Browserに新しいchipを追加した際、CLI側では資源提供・配布設定等を追加すればよく、chip固有の生成・renderingを再実装しなくて済むことを確認する。
- [x] 判明したarchitecture・制約に合わせて、このTODOとCLI.mdの対応表を更新する。

完了: 共通経路をBrowser / CLIの両方が利用し、PCM一致と既存動作を確認した上で、変更内容・architecture・テスト結果・残る制約を報告する。
01が安定する前に02以降を個別adapterの追加だけで大量実装しない。01が完了し、後続作業を安全に進められる状態で一度報告して止める。

### 02以降の実装原則

以降の「接続」は01で整えた共通interfaceを利用することを意味する。
chip固有の構成・生成・PCM処理は共有側へ一度だけ追加し、CLI側では必要なfactory / ROMの提供、オプション、配布設定を扱う。
Browser側ですでに共有化した音源は、CLIへ同じ処理を再実装しない。

### 02. YM2203のWAV変換

- [x] 共通interface経由でYM2203をCLIから利用可能にし、Node側のfactory提供・配布設定を整える。
- [x] FMと内蔵SSGを含むfixtureでWAVを検証する。
- [x] Browserが扱う併用音源の範囲を確認し、対応・拒否を明記する。

完了: YM2203のFM / SSGが欠落せず、配布したCLIでも変換できる。

### 03. YM2608のWAV変換と外部ROM入力

- [ ] 外部ROMの明示指定方法をCLIオプションとNode APIに設計・追加する。
- [ ] BrowserのYM2608エンジンを接続し、FM / SSG / ADPCMを扱う。
- [ ] リズムROMが必要な条件と不要な条件をBrowser実装に合わせる。
- [ ] ROM未指定・読み込み失敗・不正サイズを検証し、必要なROMの欠落を通知する。
- [ ] ROMそのものを同梱せず、適切な自作データで自動テストする。

完了: ROM指定を含めて再現可能なコマンドがあり、必要な音源が欠落しない。

### 04. YM2610 / YM2610BのWAV変換

- [ ] Browserの既存エンジンを接続する。
- [ ] YM2610とYM2610Bのvariantフラグ・FMチャンネル差を正しく扱う。
- [ ] FM / SSG / ADPCM-A / ADPCM-Bと埋め込みデータの転送を検証する。
- [ ] dualフラグ等、引き続き未対応の条件を明示して拒否する。

完了: 両variantで対応する発音とデータ転送を確認し、tarballでも動作する。

### 05. OKIM6258とYM2151との組み合わせ

- [ ] OKIM6258単体を接続する。
- [ ] Browserと同じ方法でYM2151 + OKIM6258を接続する。
- [ ] クロック・フラグ・PCM書き込み・ミックスを検証する。

完了: 単体・複合の両方でPCMを含むWAVが生成できる。

### 06. その他のBrowser対応音源

以下はそれぞれ独立した作業単位として処理する。

- [ ] 06a: Y8950。FMとADPCMを検証する。
- [ ] 06b: YMF278B。外部wave ROM指定、FMとPCM、ROM不足時の動作を検証する。
- [ ] 06c: Sega PCM。埋め込みサンプルとバンク設定を検証する。
- [ ] 06d: MSX系の複合音源。01で確定したBrowser対応構成を一つずつ接続・検証する。
- [ ] 06e: 32X PWMなど残る構成を対応表と照合し、Browserで動く範囲を接続・検証する。

完了: 対応表の各構成について対応済みか、残る具体的な制約が記載されている。

### 07. S98入力

- [ ] Browserの既存S98 → VGM正規化を入力処理から再利用する。
- [ ] CLI / Node APIで入力形式と正規化後の情報をどう返すか決める。
- [ ] analyze / export / renderで使えることと、不正入力の拒否を検証する。
- [ ] 元のS98ヘッダー情報を失わない形で解析結果を扱う。

完了: 自作S98 fixtureでBrowserとCLIの正規化・解析結果が一致する。

### 08. 音色の一括抽出・スナップショット

以下は形式ごとに処理し、Browserの抽出・変換処理をCore経由で共有する。

- [ ] 08a: TFI ZIP。対応するOPN / OPM音源と近似変換の注意を明示する。
- [ ] 08b: VGI ZIP。TFIと共通の抽出を再利用して検証する。
- [ ] 08c: OPM ZIP。音色変化と重複除去をBrowserと照合する。
- [ ] 08d: 時刻・チャンネルを指定した音色スナップショット。
- [ ] 出力名の衝突、空の抽出結果、既存ファイルの保護を検証する。

完了: 同じ入力・条件からBrowserと同等の音色データを取得できる。

### 09. PCMサンプル抽出

- [ ] BrowserのSample Explorerが扱う音源・形式・抽出条件を整理する。
- [ ] サンプル一覧をJSONで取得するAPI / コマンドを追加する。
- [ ] ID指定または一括でサンプルを書き出せるようにする。
- [ ] 元データとWAV変換の区別、サンプルレート・ループ等のメタデータを明示する。
- [ ] 不正な範囲・重複名・データ未収録時を検証する。

完了: 対応音源ごとにBrowserの抽出結果との一致を確認する。

### 10. 変換オプションの拡充

- [ ] 10a: 楽譜のチャンネル一覧・選択。安定した指定方法を用意しMusicXML / LilyPondで検証する。
- [ ] 10b: WAVのチャンネル / 音源ミュート。エンジンごとの対応範囲を明示する。
- [ ] 10c: WAVの開始時刻・区間指定。開始位置までのレジスタ・PCM状態を正しく再現する。
- [ ] 10d: WAVのループ指定。時間上限を必須の安全弁として保ち、無限生成を防ぐ。

完了: 各指定が出力へ反映され、不正指定を明確なエラーにする。

### 11. 複数ファイルのバッチ処理

- [ ] 複数入力・ディレクトリ入力と出力先ディレクトリの仕様を決める。
- [ ] 同名ファイルの衝突、既存出力の保護、ファイルごとの成否・終了コードを定義する。
- [ ] 一件の失敗で継続するか停止するかを指定できるようにする。
- [ ] WASMを無制限に同時起動せず、順次処理を基本として検証する。

完了: 複数曲を再現可能なコマンドで処理し、失敗した入力を特定できる。

### 12. 配布前の最終確認

- [ ] CLI.md / README / help / 対応表を実装と一致させる。
- [ ] CLIテストとAnalyzer回帰テストを実行し、既知の失敗と新規失敗を区別して記録する。
- [ ] `npm pack --dry-run`と実際のtarballで配布内容・サイズ・ライセンスを確認する。
- [ ] 別ディレクトリでtarballをインストールし、追加した代表音源・export・Node APIを検証する。
- [ ] Node.js 22以上という公開条件に合わせ、最低対応バージョンでも動作を確認する。

完了: 公開対象と検証結果をレビューできる状態にする。publishはここでは実行しない。

## 今回のTODOの対象外

- Browser UIそのものの移植、ターミナルでの対話的な音色編集・リアルタイム試聴。
- 楽譜の画像 / PDFレンダリング。MusicXML / LilyPondファイル出力とは別の機能として扱う。
- MCP Server実装、Browserが対応していない音源の追加。

## 作業記録

各作業の完了時に、変更内容・実行したテスト・残る制限をここへ追記する。

### 01 実装記録

共有生成経路・自動検証を実装。[architecture・対応表・検証条件](analyzer_cli_02_architecture.md)を参照。
Browser / CLIのchip別生成処理をplayback_coreへ集約。PCMは既存VgmPlayerを共有する。
02以降のWASM追加は実施していない。実ブラウザのUI確認は未完了のため、01の最終確認として残す。

### 02 実装記録

YM2203のNode factoryを追加。既存のplayback_core / Ym2203AudioEngineをそのまま利用し、
CLI専用の音源処理は追加していない。WASMローダーをweb / worker / node / shell用に再ビルドした。
FM単独・SSG単独・両方の自作fixtureで発音とミックスを検証し、既存Browserエンジン経路とWAVが一致。
別ディレクトリへtarballをoffline installし、CLI / Node APIの出力一致とWASM・LICENSE同梱を確認。

対応は単体YM2203（FM + 内蔵SSG）。Sega PSG / RF5C164 / 他OPN併用およびdual / variantは明示拒否。
共有Coreで扱うOKIM6258併用はNode factory未提供のためMISSING_RESOURCE（05で対応予定）。外部ROM不要。
`npm test`: 14成功。`npm run test:analyzer`: 583成功、0失敗、外部コンパイラ検証1skip。
実ブラウザUI操作とNode 22での検証は引き続き未実施。次工程は03（YM2608・外部ROM入力）。
