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

- [x] 外部ROMの明示指定方法をCLIオプションとNode APIに設計・追加する。
- [x] BrowserのYM2608エンジンを接続し、FM / SSG / ADPCMを扱う。
- [x] リズムROMが必要な条件と不要な条件をBrowser実装に合わせる。
- [x] ROM未指定・読み込み失敗・不正サイズを検証し、必要なROMの欠落を通知する。
- [x] ROMそのものを同梱せず、適切な自作データで自動テストする。

完了: ROM指定を含めて再現可能なコマンドがあり、必要な音源が欠落しない。

### 04. YM2610 / YM2610BのWAV変換

- [x] Browserの既存エンジンを接続する。
- [x] YM2610とYM2610Bのvariantフラグ・FMチャンネル差を正しく扱う。
- [x] FM / SSG / ADPCM-A / ADPCM-Bと埋め込みデータの転送を検証する。
- [x] dualフラグ等、引き続き未対応の条件を明示して拒否する。

完了: 両variantで対応する発音とデータ転送を確認し、tarballでも動作する。

### 05. OKIM6258とYM2151との組み合わせ

- [x] OKIM6258単体を接続する。
- [x] Browserと同じ方法でYM2151 + OKIM6258を接続する。
- [x] クロック・フラグ・PCM書き込み・ミックスを検証する。

完了: 単体・複合の両方でPCMを含むWAVが生成できる。

### 06. その他のBrowser対応音源

以下はそれぞれ独立した作業単位として処理する。

- [x] 06a: Y8950。FMとADPCMを検証する。
- [x] 06b: YMF278B。外部wave ROM指定、FMとPCM、ROM不足時の動作を検証する。
- [x] 06c: Sega PCM。埋め込みサンプルとバンク設定を検証する。
- [x] 06d: MSX系の複合音源。01で確定したBrowser対応構成を一つずつ接続・検証する。
- [x] 06e: 32X PWMなど残る構成を対応表と照合し、Browserで動く範囲を接続・検証する。

完了: 対応表の各構成について対応済みか、残る具体的な制約が記載されている。

### 07. S98入力

- [x] Browserの既存S98 → VGM正規化を入力処理から再利用する。
- [x] CLI / Node APIで入力形式と正規化後の情報をどう返すか決める。
- [x] analyze / export / renderで使えることと、不正入力の拒否を検証する。
- [x] 元のS98ヘッダー情報を失わない形で解析結果を扱う。

完了: 自作S98 fixtureでBrowserとCLIの正規化・解析結果が一致する。

### 08. 音色の一括抽出・スナップショット

以下は形式ごとに処理し、Browserの抽出・変換処理をCore経由で共有する。

- [x] 08a: TFI ZIP。対応するOPN / OPM音源と近似変換の注意を明示する。
- [x] 08b: VGI ZIP。TFIと共通の抽出を再利用して検証する。
- [x] 08c: OPM ZIP。音色変化と重複除去をBrowserと照合する。
- [x] 08d: 時刻・チャンネルを指定した音色スナップショット。
- [x] 出力名の衝突、空の抽出結果、既存ファイルの保護を検証する。

完了: 同じ入力・条件からBrowserと同等の音色データを取得できる。

### 09. PCMサンプル抽出

- [x] BrowserのSample Explorerが扱う音源・形式・抽出条件を整理する。
- [x] サンプル一覧をJSONで取得するAPI / コマンドを追加する。
- [x] ID指定または一括でサンプルを書き出せるようにする。
- [x] 元データとWAV変換の区別、サンプルレート・ループ等のメタデータを明示する。
- [x] 不正な範囲・重複名・データ未収録時を検証する。

完了: 対応音源ごとにBrowserの抽出結果との一致を確認する。

### 10. 変換オプションの拡充

- [x] 10a: 楽譜のチャンネル一覧・選択。安定した指定方法を用意しMusicXML / LilyPondで検証する。
- [x] 10b: WAVのチャンネル / 音源ミュート。エンジンごとの対応範囲を明示する。
- [x] 10c: WAVの開始時刻・区間指定。開始位置までのレジスタ・PCM状態を正しく再現する。
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
- [ ] `npm run pack:check`と実際のtarballで配布内容・サイズ・ライセンスを確認する。
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

### 03 実装記録

YM2608のNode factoryとNode対応WASMローダーを追加。生成・PCM処理は既存共有recipeを利用。
CLI: `render song.vgz --output song.wav --ym2608-rom /path/to/ym2608_adpcm_rom.bin`。
Node API: `renderSource(source, {roms:{ym2608AdpcmA:bytes}})`。
Node入力は完全な8192-byte Uint8Array / Bufferとし、部分ROM入力は公開しない。
Browserの低レベル部分ロードAPIは変更していない。

ROM必要性はBrowserと同じparserのリズムkey-on検出を利用。FM / SSG / 埋め込みADPCM-Bのみなら不要。
各音源を単独で発音させ、既存Browserエンジン経路とのWAV一致を検証。
自作リズムデータのみ使用し、ROM未指定・不正型/サイズ・読込失敗・dual / 併用拒否を検証。
別ディレクトリのoffline tarball installからCLI / Node APIでROM指定して出力一致を確認。
配布物にWASM・ライセンスを含み、ROM・fixtureを含まないことも検証。

`npm test`: 16成功。`npm run test:analyzer`: 583成功・0失敗・外部コンパイラ検証1skip。
実ブラウザUIとNode 22の実機検証は未実施。04（YM2610/B）は次工程。

### 04 実装記録

YM2610/Bの既存Node対応factoryをCLIへ提供。共有recipeのvariant bit判定・生成・PCM処理は変更不要。
自作fixtureで両variantのFM / SSG / ADPCM-A / ADPCM-Bとmixを個別確認。
CH1・CH4がYM2610では無音、YM2610Bでは発音することを確認。
Browserで使う既存エンジンの生成経路とのWAV一致、埋め込みROMの範囲不正、dual・併用拒否を検証。
別ディレクトリのoffline tarball installで両variantのCLI / Node APIの出力一致を検証。
外部ROM入力は対象外。VGMに埋め込まれた0x82/0x83データを使用し、ゲームデータは配布しない。

`npm test`: 20成功。`npm run test:analyzer`: 583成功・0失敗・外部コンパイラ検証1skip。
実ブラウザUIとNode 22の実機検証は未実施。次は05（OKIM6258・YM2151併用）。

### 05 実装記録

既存Node対応OKIM6258 factoryを提供し、BSD-3-Clauseライセンスをtarballへ追加。
単体・YM2151併用とも共有Coreを利用し、chip固有のCLI処理は追加していない。
自作PCM / FM fixtureで両方の発音を確認し、ミックスの各サンプルが単体出力の和と一致。
クロック・分周・10/12-bit精度・pan、および3-bit / dual / variant拒否を検証。
配布tarballを別ディレクトリへoffline installし、単体・併用のCLI / Node API出力一致を検証。
既存のparser・stream・reset・dispose検証はAnalyzer回帰テストで実施。

`npm test`: 22成功。`npm run test:analyzer`: 583成功・0失敗・外部コンパイラ検証1skip。
他engineへのOKIM6258付加も共有factoryで可能になるが、この工程の専用mixテストはYM2151のみ。
実ブラウザUIとNode 22の実機検証は未実施。次は06a（Y8950）。

### 06a 実装記録

Y8950の既存Node対応factoryを提供。共有recipe・エンジンは変更せず、FM / ADPCMをCLIで利用可能にした。
自作fixtureでFM単独・ADPCM単独・mix・Sega PSG併用を発音検証。
Browserエンジン経路とのWAV一致、reset後のサンプル再ロード、dual / variant / 他音源混在拒否、
不正sample block範囲の拒否を確認。tarballからCLI / Node APIの出力一致も検証。
MSX複合recipeもfactoryを利用できるが、専用検証は06dで実施する。
外部ROM・ゲームデータは追加していない。ymfmは既存BSD-3-Clauseライセンスの範囲。

`npm test`: 24成功。`npm run test:analyzer`: 583成功・0失敗・外部コンパイラ検証1skip。
実ブラウザUIとNode 22での検証は引き続き未実施。次は06b（YMF278B・wave ROM入力）。

### 06b 実装記録

YMF278Bの既存Node対応factoryを提供。CLI `--ymf278b-rom FILE` と
Node API `roms.ymf278bWave`（2097152-byte Uint8Array / Buffer）を追加。
ROM取得はadapterのみ、必要性判定・投入・PCM生成はBrowserと同じCoreを利用。
自作波形でFM / PCM単独・mix・PSG併用を発音検証し、Browserエンジン経路とのWAV一致とresetを確認。
同じ波形の埋め込み／外部ROMの出力一致、ROM不足・不正型/サイズ・読込失敗、dual / variant / 混在拒否も確認。
tarballの別ディレクトリoffline installから外部ROM付きCLI / Node API実行を検証。
実ROMを使用・同梱せず、テスト時に2 MiBの自作wave ROMを生成する。

必要性判定は既存Browserと同じくPCM key-onと非空sample blockの有無による。
埋め込みデータの完全性は判定しないため、部分的なデータでは不足する音色がありうる。
`npm test`: 26成功。`npm run test:analyzer`: 583成功・0失敗・外部コンパイラ検証1skip。
実ブラウザUIとNode 22での検証は未実施。次は06c（Sega PCM）。


### 06c 実装記録: Sega PCM

- Node factory一覧に既存Sega PCM WASMを追加。共有recipe・engine・PCM処理の変更やCLI専用engineの追加は不要。
- Sega PCM単体、PSG併用、YM2151併用、YM2151 + PSG併用を検証。
- 自作の埋め込みROM（0x80）と0xC0書き込みで発音を確認。headerのbank shift/maskによる2バンクの選択、左右音量、reset後の再現をテスト。
- Browser用の既存engineを直接生成したWAVとNode出力がバイト一致。dual/variant・非対応構成・ROM範囲超過は拒否。
- tarball内のWASM・ライセンスを確認。別ディレクトリへoffline installし、CLIとNode APIで単体・複合のWAVを検証。
- `npm test`: 28件成功。`npm run test:analyzer`: 584件中583成功・0失敗・1skip（任意の外部mml2mdrテスト）。

外部Sega PCM ROM指定は追加していない。VGMの埋め込みサンプルを使用する。
実ブラウザUIとNode 22での検証は未実施。次は06d（MSX系の複合音源）。


### 06d 実装記録: MSX系の複合音源

- Node providerにK051649 WASMを追加し、npm配布へBSD-3-Clauseのライセンスを同梱。既存のMSX共通recipe / engine / PCM処理は変更不要。
- AY / YM2413 / Y8950 / K051649の各1台からなる全15構成を自作fixtureで検証。Y8950はFMと埋め込みADPCM、SCCはレジスターから書いた波形で発音する。
- 各構成のWAVはBrowser用engineの直接生成と一致し、reset後も一致。左右のFloat32 PCMが各単体のPCM合計と一致することを検証し、複合時の音源欠落を検出する。
- 4音源それぞれのdual / variantフラグ、非対応の他系列との混在、second SCC書き込みを拒否するテストを追加。
- offline installしたtarballでSCC単体、AY + OPLL、4音源混合をCLI / Node APIの両方から実行し、WAV一致・WASMとライセンスの同梱を確認。
- `npm test`: 30件成功。`npm run test:analyzer`: 584件中583成功・0失敗・1skip（任意の外部mml2mdrテスト）。

すべてのMSX実機variantへの対応を意味するものではない。現行Browser/Coreが受け付ける各音源1台の構成を対象とする。
実ブラウザUIとNode 22での検証は未実施。次は06e（32X PWMなど残る構成）。


### 06e 実装記録: 32X PWMと残る構成の照合

- 共有recipeが要求する18種類のWASM factoryはすべてNode providerに存在することを照合。PWMは既存Genesis engine内のJS処理なので追加WASM・CLI専用engineは不要。
- 自作fixtureでPWM単体（直接書き込み / 16-bit stream / stereo）、FM・PSG・RF5C164との各併用、4音源混合を確認。
- 直接書き込みと同時刻のstream出力がWAVで一致。Browser用engineの直接生成とCLIのWAV、reset後の出力も一致。混合時のPWM / PSG / PCMのミュートで各音源の寄与を検証。
- dual / variantと非対応系列との混在を拒否するテストを追加。offline installしたtarballからPWM streamと4音源混合をCLI / Node APIで実行。
- `npm test`: 32件成功。`npm run test:analyzer`: 584件中583成功・0失敗・1skip（任意の外部mml2mdrテスト）。

制約: PWMは値を次のwriteまで保持する近似であり、FIFO / hardware timerは再現しない。
PWM単体でも既存Genesis engineがYM2612 / PSGを初期化するため、YM2612の無発音時DC成分が加わる。Browser互換の既存動作として維持。
全factory提供は任意のchip混在の保証ではない。OKIM6258の追加は単体 / YM2151併用を実発音検証済みで、他engineとの全組み合わせは未検証。
実ブラウザUI・Node 22・実曲網羅テストは残る。次は07（S98入力）。


### 07 実装記録: S98入力

- Browserと同じ `s98_file.js` の変換をCoreのdecodeで再利用。S98 v0〜3、単一YM2203 / YM2608 / YM2612という既存制約を維持する。
- bytesを返すreadSource / decodeSourceは互換維持。元情報を保持するreadSourceDocument / decodeSourceDocumentを追加し、`{bytes, sourceHeader?}` をanalyze / export / renderで受け付ける。
- CLIはdocumentを使い、JSONのsourceHeaderへ元format・実効timer比・source offsets・devices・tagを保持。通常のheader / metadataは正規化VGMを記述し、S98タグをGD3と偽らない。VGM/VGZのJSONは変更なし。
- 3音源の自作fixtureでBrowserとのbytes / metadata一致、fractional timerとloop、各対応export・WAV、CLIを検証。不正header・port・圧縮指定・複数device・未対応device・end不足を拒否。
- offline tarballでS98 JSON / document API / WAVを検証。`npm test` 34成功、Analyzer 583成功・0失敗・1任意skip。
- 既存CLI.md冒頭へのテストコード混入を履歴から修復し、後続音源説明を保持。

documentからbytesだけを取り出すと元情報は失われるので、必要な呼び出し元はdocumentを保持する。
実ブラウザUIとNode 22は未確認。次は08a（TFI ZIP）。


### 08a 実装記録: All TFI ZIP

- `export --format tfi-zip` とNode exportSourceに対応。OPN抽出とZIP writerを環境非依存モジュールへ移し、Browserからも同じ処理を利用。
- YM2203 / YM2608 / YM2610(B) / YM2612のkey-on音色をチャンネルごとに重複除去。OPMは既存の近似変換・source OPM・conversion.jsonをそのまま利用する。
- 複数FM系列・dual / 未対応variantを拒否し、空の結果はエラー。OPNのheld-key変化のみは抽出対象外。TFIのpan/modulation・clock補正の制約をCLI.mdへ記載。
- 出力はbytes/count/warnings。CLI ZIPは固定日時で再現可能、Browserは従来通り現在日時。重複entry名を拒否する。上書きには--forceが必要で、空結果でも既存ファイルを破壊しない。
- 各音源のTFI bytesとBrowser抽出結果を比較。既存Browser ZIP/monitorテストを共有module importへ更新。実tarballでOPM変換ZIPも確認。
- `npm test`: 36成功。Analyzer: 583成功・0失敗・1任意skip。itch用同梱ファイルとimport書き換えも更新し、cli08a-checkパッケージ生成・依存検査成功。

実ブラウザUIとNode 22の確認は残る。次は08b（VGI ZIP）。


### 08b 実装記録: All VGI ZIP

- `export --format vgi-zip --output voices.zip` とNode APIの `exportSource(source,{format:'vgi-zip'})` に対応。
- TFIと同じ音源構成検証・OPN抽出・ZIP生成を共有。Browserと同じVGIエンコーダーを使用し、音源固有処理をCLIに追加していない。
- YM2203 / YM2608 / YM2610(B) / YM2612に対応。YM2151のVGI変換は未対応として明示的に拒否する。
- B4（pan/AMS/FMS）を保持。global LFO・operator AM enable・クロック由来の時間差は保存しない。key-on抽出・チャンネルごとの重複除去・dual/混在制約はTFIと共通。
- Browser ZIPの全OPN構成でバイト一致、両port・非既定B4・重複key-onを検証。空結果・既存ファイル保護・force・未対応構成も検証。
- `npm test`: 38成功・0失敗。実tarballのoffline install後、CLIとNode APIからVGI ZIPを出力して照合。
- `npm run test:analyzer`: 583成功・0失敗・1任意skip。itchのcli08b-checkパッケージ生成・依存検査成功。

実ブラウザUIとNode 22の確認は残る。次は08c（OPM ZIP）。


### 08c 実装記録: All OPM ZIP

- CLI `export --format opm-zip --output opm.zip` とNode API `exportSource(source,{format:'opm-zip'})` に対応。
- Browserの `extractOpmPatches` とOPM text encoderをそのまま共有し、Coreで既存ZIP writerへ渡す。DOM・音源初期化・filesystemへの依存追加なし。
- 単一・非variantのYM2151を対象とし、dual/variantは拒否。他音源の併存時も抽出対象はYM2151のみ。
- key-on / held-key音色変更 / global LFO・noise変更を抽出。チャンネル別の重複除去を維持し、pitch-only変更では増やさない。
- Browserと同じファイル名・OPM本文・first-observed sample・source clockを保持。空結果はエラー、既存出力はforceなしで保護。
- `npm test`: 40成功・0失敗。実tarballのoffline install後、CLI／Node APIからのOPM ZIPを照合。
- `npm run test:analyzer`: 583成功・0失敗・1任意skip。held-key変更と重複除去の既存テストにCore ZIP比較を追加。
- itch cli08c-checkのパッケージ生成・依存検査成功。実ブラウザUIとNode 22は未確認。

次は08d（時刻・チャンネル指定の音色スナップショット）。


### 08d 実装記録: 時刻・チャンネル指定の音色スナップショット

- `export --format tfi|vgi|opm --at SECONDS --channel N --output FILE` に対応。Core APIは `exportSource(source,{format,atSeconds,channel})`。チャンネルは両方とも1始まり。
- OPN/OPMの既存抽出ループを状態scanとして共用し、指定時刻ではZIP用captureを省略。レジスターdecode・encoderをCLIへ複製していない。
- 秒を44100 Hz sampleへ切り下げ、同時刻の全writeを反映。wait途中は直前状態、曲末ちょうどは許可、曲末超過はエラー。loop展開なし。
- OPNはTFI/VGI、YM2151はOPM。YM2203は1〜3、YM2610は2/3/5/6、YM2610B・YM2608・YM2612は1〜6、YM2151は1〜8。
- dual/非対応variant/混在FMを拒否。YM2151→TFI snapshotの近似変換は今回含めず、OPM保存を案内する。
- key-on不要。未write部分は共有extractorの初期値。Browserの全monitor情報や発音位相を保存するものではなく、静的音色出力として仕様を明記。
- 時刻境界・曲末・範囲外・key-onなし・全OPN系・OPM Browser encoderとの一致を追加検証。CLIのforce/既存出力保護と実tarballのCLI/Node API出力も確認。
- `npm test`: 43成功・0失敗。`npm run test:analyzer`: 583成功・0失敗・1任意skip。
- itch cli08d-checkの生成・依存検査成功。実ブラウザUIとNode 22は未確認。

次は09（PCMサンプル抽出）。まず既存Sample Explorerの形式と抽出条件を整理する。


### 09a 実装記録: Sample inventory

- Browserの抽出を `sample_core.js` に分離。UIは同じ関数をimport/re-exportし、既存呼び出しを維持。CoreからUI・WebAudio・動的WASM loaderへの依存を避ける。
- `samples FILE --json` と `listSourceSamples(source,{signal})` を追加。schemaVersion 1、timebase 44100。binary/capture配列を除いた定義・使用イベント・警告を返す。
- 対象: YM2610/B ADPCM-A/B、YM2608 external-memory ADPCM-B、RF5C164 RAM、YM2612 DAC、32X PWM。
- raw-adpcm / ram-snapshot / timed-outputを明示。DAC/PWMは原音色境界でなく最大10秒窓。RF5C164は再生経路が揃えばRAM全体未収録でもexportableとなる。
- 世代別メモリー、使用ごとのrate/loop、null終了時刻を維持。後からのuploadで過去の欠損を補完しない。
- rhythm、CPU playback、一部wrapped range、他chipの抽出は対象外。空一覧はPCM不存在の証明ではない。
- 次は09b: ID指定・一括書き出し。raw/timed JSON/WAVを分け、欠損・衝突・出力保護を検証する。

検証: npm test 45成功・0失敗、Analyzer 583成功・0失敗・1任意skip。実tarballのCLI/Node API一覧照合とitch cli09a-checkの生成・依存検査成功。実ブラウザUIとNode 22は未確認。


### 09b 実装記録: native sample extraction

- `samples FILE --id N --output FILE` / `--all --output ZIP` と `exportSourceSamples(source,{id|all,signal})` を追加。
- Browserのnative saveを `sampleFile` として共有。ADPCM/RF5C164 RAMはbin、DAC/PWMはtimed JSON。WAVへの変換は行わない。
- 一括ZIPはchip-kind-ID名とmanifest.jsonを格納。manifestは一覧・rate/loop等の使用イベント・警告を保持する。
- 空結果・無効ID・競合指定・欠損データはwrite前に拒否。全件指定は欠損を黙ってskipせずエラー。既存出力はforceなしで保護。
- RAMの未観測領域はBrowserと同じ扱い（既知の再生経路外にゼロを含みうる）。rawデータから音色境界を推測しない。
- 次は09c: WAV変換の共有interfaceと対応範囲を整理・実装し、09の残る検証項目を完了する。

検証: npm test 49成功・0失敗（CLI option回帰を修正後に全件再実行）。Analyzer 583成功・0失敗・1任意skip。実tarball CLI/Node API ZIP一致、itch cli09b-final-check生成・依存検査成功。実ブラウザUIとNode 22は未確認。


### 09c 実装記録: Sample preview WAV

- `samples FILE --id N --format wav --occurrence N --output FILE` を追加。occurrenceはIDごとの使用イベント内で1始まり。
- `sample_render.js` にBrowserのconfigure・音源生成・PCM生成を移し、Browserも呼び出す。Nodeは既存getNodePlaybackFactoryを注入するだけでchip固有renderingを持たない。
- Node便利API `exportNodeSamples` と、factory注入可能なCore `exportSourceSamples`。DAC/PWMは既存JS preview、ADPCM/RF5C164は既存WASM。
- stereo PCM16。DACはmono複製、PWMはstereo、ADPCM/RF5C164はBrowserと同じcentered設定。WASM PCMはdispose前にcopy。
- 最大10秒、Browserのsize/rate見積りとpaddingを維持。厳密な自然終端ではなくpreview。RF5C164 loop markerは窓内で反復しうる。sampleRateはWAVヘッダー用に整数丸め、resampleなし。
- WAVは単一IDのみ。欠損・無効occurrence・ゼロrate・factory不足を拒否。native一括ZIPは09bのまま。

検証: npm test 52成功・0失敗、Analyzer 583成功・0失敗・1任意skip。ADPCM旧Browser手順/PWM保存WAVとの一致、異常時dispose、実tarball CLI/Node API WAV一致を確認。itch cli09c-check生成・依存検査成功。実ブラウザUIとNode 22は未確認。次は10（renderオプション）。


### 10a 実装記録: 楽譜チャンネル一覧・選択

- `score-channels FILE --json` とCore `listSourceScoreChannels` を追加。既存scoreのlabelからIDを作り、name/noteCountを返す。
- MusicXML/LilyPondの `--channels ID,ID` / API `channels:[...]` に対応。既存Browser exporterへ選択した譜表を渡すだけで、譜面生成処理を複製しない。
- 元の譜表順・曲全体のtime・tempo suggestionを維持。未指定は従来どおり全譜表。無音譜表も選択可能。
- 空・重複・未知IDと他formatへの指定は拒否。snapshotの単数channelとは独立。
- 一覧は既存score抽出範囲であり、全hardware channelの対応表ではない。
- 次は10b（WAVミュート）。11のバッチ処理は10の後に進める。

検証: npm test 54成功・0失敗。Analyzer 583成功・0失敗・1任意skip。全譜表の従来出力維持・選択後のBrowser exporter一致、実tarball CLI/Node APIの両形式一致と不正指定時の出力保護を確認。itch cli10a-check生成・依存検査成功。実ブラウザUIとNode 22は未確認。


### 10b 実装記録: WAVミュート

- `render --mute ID,ID` / Node `renderSource(source,{mute:[...]})` に対応。
- CoreのplaybackMuteControls/applyPlaybackMutesで既存Browser engine methodsを一元管理。環境依存処理や別PCM engineは追加しない。
- 構成に存在するsourceと既存公開channel controlsだけを許可。全IDを検証してから適用し、未知/重複IDはwrite前にエラー。
- 対応表はCLI.mdに記載。YM2612/2608/2610 FM個別、PSG個別、複合MSXのOPLL/Y8950個別は既存interfaceにないため未対応を明記。
- ミュートでも音源構成/ROM要件は変えない。指定なしは従来PCMを維持。次は10c（開始時刻・区間指定）。

検証: npm test 56成功・0失敗、Analyzer 583成功・0失敗・1任意skip。代表source/channelのPCM変化・全ID検証後の適用・不正指定時の既存出力保護・実tarballのWAV一致を確認。itch cli10b-check生成・依存検査成功。実ブラウザUIとNode 22は未確認。


### 10c 実装記録: WAV開始・区間

- `render --start SECONDS --max-seconds DURATION` / Node・共通WAV coreの `startSeconds` を追加。
- 先頭から同じblockサイズでplayer.processし、開始前PCMを破棄。途中blockから切り出し、FM位相・RAM・resampler状態を維持。別seek engineなし。
- 開始/長さは出力frameへ四捨五入。start>=0、duration>0、有限、合計<=600秒。start省略時は従来出力。
- 既存の最終block silenceを維持。rendered end超過はエラー、最終padding内は選択可能。曲末で区間は短くなる。
- FM/ADPCM/PWMで全体WAVのsliceと一致、block境界を跨ぐ開始、不正範囲と既存出力保護を検証。
- 次は10d（WAVループ指定）。

検証: npm test 58成功・0失敗、Analyzer 583成功・0失敗・1任意skip。実tarballの区間WAVとNode出力一致、itch cli10c-check生成・依存検査成功。実ブラウザUIとNode 22は未確認。

### npm配布READMEの分離

- ルートREADMEはリポジトリ用、`cli/README.md`はnpm利用者用に分離。
- `npm run pack`は一時ディレクトリにdist・ライセンス・CLI.mdと専用READMEを配置してtarballを作成する。ルートREADMEは変更しない。
- `npm run pack:check`で配布内容を確認する。ルートで直接`npm pack`するとリポジトリREADMEが入るため、配布には専用コマンドを使う。
- tarballを別ディレクトリへインストールし、README一致・ルートREADME保持と既存CLI/APIを回帰テストする。公開は行わない。
- 検証: `npm test` 58件成功。`npm run pack:check`成功（120ファイル、圧縮493.5 kB）。実tarballのオフラインインストール後に専用READMEとCLI/API動作を確認。Node.js 22での確認は未実施。
