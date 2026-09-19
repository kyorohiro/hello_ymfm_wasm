現在の Tetorica VGM Analyzer を調査し、tetorica-vgm というCLIアプリとして利用できるようにしてください。

最終的には npm package として公開できる状態にしてください。

目的

現在ブラウザから利用しているVGM Analyzerの機能を、UIを使わずCLIやNode.jsから利用できるようにしたいです。

将来的には、このCLI/Coreを利用してMCP Serverを実装し、CodexやClaudeなどのAI AgentからVGM解析を利用できるようにする予定です。

方針

* 既存Browser版の動作を壊さない
* Browser版とCLI版で解析ロジックをコピーしない
* 可能な限り共通のAnalyzer Coreを利用する
* UI依存の処理と解析処理を分離する
* 将来MCP Serverから同じCoreを利用できる構造にする
* CLI固有の都合をAnalyzer Coreへ持ち込まない
* 既存機能・既存テストを確認してから設計する

理想的には以下のような構造です。

                 analyzer-core
                /      |       \
           Browser    CLI      MCP (future)

CLI

最初に現在のAnalyzerで実際に利用可能な機能を調査し、CLIとして公開すべきcommand/optionsを設計してください。

例えば以下のような利用を想定していますが、既存実装に合わせて適切に設計してください。

tetorica-vgm analyze song.vgz
tetorica-vgm analyze song.vgz --json
tetorica-vgm export song.vgz --format midi
tetorica-vgm export song.vgz --format musicxml
tetorica-vgm render song.vgz --output song.wav

既存Analyzerが対応していない機能を、この依頼のためだけに新規実装する必要はありません。

npm

CLIとして安定して動作することを確認した後、npm package tetorica-vgm として公開可能な状態にしてください。

* npx tetorica-vgm ... で実行可能
* Node.jsからlibraryとして利用することも検討
* packageに不要なBrowser assetsを含めない
* READMEにCLI usageを記載
* version / files / bin / exports等を適切に設定
* publish前にpackage内容を確認できるようにする

npmへの実際のpublishを行う前に、package内容・公開対象・テスト結果を確認してください。

Test

実際のVGM/VGZ fixtureを使用して、少なくとも以下を自動テストできるようにしてください。

* VGM/VGZを読み込める
* chip情報を取得できる
* 基本的な解析結果をJSONとして取得できる
* 対応済みexportがCLIから実行できる
* Browser版とCLI版でCoreの解析結果が乖離しない

まず既存repositoryを調査し、現在のAnalyzer architectureと依存関係を把握してから実装してください。