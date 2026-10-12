# Tauri 版 Playground：内蔵 Git の実装メモ

状態：初期実装を Tauri ラッパーの別リポジトリ `w/tetorica-fm2612-playground-tauri` に追加。配布・実ホストでの検証は未実施。

## 目的

Tauri 版 Playground で、編集した音楽コード・プリセット・サンプルなどを Git で管理できるようにする。
既存の Virtual Files、Monaco Editor、Shell を利用し、実フォルダと native 側の Git 処理につなぐ。

## 決めた方針

- Git はアプリに内蔵し、システムの Git CLI は呼ばない。
- `.git`、実ファイルの保存、Git 操作、SSH 認証は native 側で扱う。
- WebView は編集・操作要求・結果表示を担当する。
- WebView から native にプロジェクトの snapshot を渡す構成とする。
- 利用できる SSH 鍵は、Playground が native 側で生成したものだけとする。
- SSH 秘密鍵はパスフレーズ必須とし、空のパスフレーズ・暗号化していない保存を認めない。
- 既存の秘密鍵の取り込み、システムの ssh-agent を利用した認証は対象外とする。
- 秘密鍵・パスフレーズを WebView、Virtual Files、snapshot に渡さない。

## 全体構成

```text
Playground / WebView
  Virtual Files・Monaco・Shell・Git 操作 UI
       ↓ snapshot / 専用 API の操作要求
Tauri / Rust
  プロジェクト管理・ファイル同期・競合検出
  内蔵 Git ライブラリ
  SSH 鍵の生成・暗号化保存・認証
       ↓ 状態 / 差分 / 履歴 / 更新されたファイル
Playground / WebView
```

Git ライブラリは `git2` + `libgit2` の組み込みを第一候補とする。
`git2` は Rust の API、`libgit2` は C の Git 実装であり、pure Rust の実装ではない。
`libgit2` と必要な SSH・HTTPS の依存ライブラリをアプリに同梱する構成を検証する。
鍵生成も内蔵ライブラリで行う方針とし、`ssh-keygen` などの外部コマンドには依存しない。

## 実フォルダと Virtual Files の連携

現在の Playground は Virtual Files を共有して編集・実行し、Tauri 版の自動保存は IndexedDB に保存している。
Git の導入には、実フォルダのプロジェクトとの連携が必要になる。

### フォルダを開く

1. ユーザーが実フォルダを選択する。
2. native が管理対象のファイルを読み、Virtual Files に取り込む。
3. native が読み込み時の内容・管理対象一覧・プロジェクト ID を保持する。
4. `.git` は native 側に残し、Virtual Files に取り込まない。

### 保存・コミット

1. Monaco の未反映の編集を Virtual Files に反映する。
2. WebView が snapshot と保存元のリビジョンを native に渡す。
3. native がパス・管理対象・外部変更を検証する。
4. 変更・追加・明示的な削除を実フォルダへ反映する。
5. 保存完了後に Git の差分取得・ステージ・コミットなどを実行する。

**snapshot に存在しないという理由だけで、実フォルダのファイルを全部削除しない。**
Playground が管理している範囲だけを更新し、削除は管理対象と削除の意図を確認して扱う。
実フォルダで別のエディタが変更した場合は、読み込み時の内容と比較して競合を検出し、無条件に上書きしない。

保存と Git 操作は同じプロジェクト内で直列化する。
古い snapshot が新しい保存を上書きすることや、保存途中にコミットすることを防ぐ。
複数ファイル保存の途中で失敗した場合の復旧方法は、実装時に決める。

### Git によるファイル更新

pull・checkout などで実フォルダが変更されたら、Virtual Files と Monaco に取り込み直す。
未保存の編集がある場合の扱いを決め、取り込みで編集内容を失わないようにする。
IndexedDB の自動保存と実フォルダ保存の役割、復元時の優先順位も整理する。

## SSH 鍵・認証

- 鍵は native 側で生成し、暗号化した秘密鍵をアプリ専用領域に保存する。
- 鍵の生成・復号に使うパスフレーズは、OS の native 入力 UI で受け取る方針とする。
- WebView に返す情報は、鍵 ID・公開鍵・フィンガープリント・表示用の名前などに限定する。
- ユーザーが公開鍵を Git ホスティングサービスへ登録できるようにする。
- 復号された鍵は native の認証処理に限って利用し、利用後は保持を最小限にする。
- 秘密鍵とパスフレーズをログ、エラー、cassette のエクスポート、自動保存に含めない。
- 接続先のホスト鍵を検証し、初回接続・鍵変更時の確認方法を用意する。

パスフレーズによる暗号化は保存中の鍵を保護する。
WebView からの不正な利用要求は、native API の操作範囲・プロジェクト・接続先の検証で別途制限する。

## native API と Shell

API 名は仮案。任意のコマンド文字列を実行する API は作らず、Git の操作ごとに処理を用意する。

| 操作 | API の例 |
| --- | --- |
| フォルダを開く・同期する | `project_open` / `project_save_snapshot` / `project_reload` |
| 初期化・変更確認 | `git_init` / `git_status` / `git_diff` |
| ステージ・コミット・履歴 | `git_stage` / `git_commit` / `git_log` |
| リモート操作 | `git_clone` / `git_fetch` / `git_pull` / `git_push` |
| 鍵の管理 | `ssh_key_generate` / `ssh_key_list` / `ssh_key_public` |

Shell の `git status` などは、対応する入力を解析して専用 API に渡す。
システムの Git CLI を実行するものではなく、対応するサブコマンド・オプションを明示する。
処理結果・進捗・失敗理由を Shell または Git 操作 UI に表示する。

native 側で以下を保証する。

- 操作対象はユーザーが開いたプロジェクト ID に結び付ける。
- snapshot やパス指定から `.git`・鍵の保存領域・プロジェクト外へ書き込めない。
- 相対パスの `..`、絶対パス、シンボリックリンクによる範囲外アクセスを検証する。
- WebView から任意の秘密鍵パスや認証先を指定させず、アプリ管理の鍵 ID と設定済み remote を使う。
- push では接続先・ブランチ・送信する変更を確認できるようにする。
- 重いファイル処理・Git 操作を音声処理や WebView の UI スレッドで実行しない。

## 実装順序の案

### 1. 実フォルダ連携とローカル Git

- [x] 実フォルダの選択・読み込みと Virtual Files への取り込み。
- [x] snapshot 保存、管理対象一覧、外部変更の競合検出。
- [x] `git2` / `libgit2` を組み込んだ Tauri ビルド。
- [x] `init` / `status` / `diff` / `add` / `commit` / `log`。
- [x] Shell への基本操作の接続。

まず「snapshot を保存し、差分を見て、ローカルでコミットできる」状態を作る。

### 2. アプリ専用の SSH 鍵

- [x] 鍵生成とパスフレーズ必須の暗号化保存。
- [x] native のパスフレーズ入力 UI（macOS）。他OSは未実装。
- [x] 公開鍵の表示と鍵 ID の管理。コピーは表示されたテキストの選択で行う。
- [x] 内蔵 SSH ライブラリで生成した鍵を利用できることの検証。
- [x] ホスト鍵の検証・接続先と鍵の関連付け。

### 3. リモート Git

- [x] `clone` / `fetch` / `push` とキャンセル要求。
- [ ] 実ホストでの通信確認、転送量を含む詳細な進捗表示。
- [x] fast-forward `pull` と実フォルダ・Virtual Files・Monaco の再同期。
- [ ] 未保存の編集、分岐した履歴、マージ競合の扱い。

## 実装前・実装中に確認すること

- Tauri native 側のコードの所在と、既存のプロジェクト保存機能との接続方法。
- macOS / Windows / Linux の対象範囲と、Git・SSH 依存の同梱方法。
- 内蔵ライブラリの鍵形式・暗号化方式の互換性。初期実装では Ed25519 を使用。
- WebView を経由しないパスフレーズ入力 UI を各 OS でどう実装するか。
- native が保管する snapshot のリビジョンと、外部変更の検出方法。
- 読み込むファイルの範囲、大きいサンプルの転送方法、`.gitignore` の扱い。
- 最初の `pull` は fast-forward のみに限定するか、マージまで実装するか。
- ブランチ操作、履歴の書き換え、コミット署名、LFS、submodule は初期段階に必要か。
- Git CLI・OpenSSH の設定や hooks など、内蔵実装で対応する範囲を明示する。

## 主な検証項目

- Git 未インストールの環境で、ローカル操作・SSH 通信が動作する。
- テキスト・バイナリ・追加・削除を保存でき、管理外ファイルを維持する。
- 外部変更・古い snapshot・未保存の編集でデータを失わない。
- 不正なパス・プロジェクト ID・鍵 ID を native 側で拒否する。
- パスフレーズなしの鍵、外部の鍵、未検証の接続先を利用しない。
- 認証失敗・ネットワーク切断・キャンセルから再試行できる。
- Git 操作中も Playground の再生・停止・試聴が正常に動作する。

## 参考

- [git2：Rust API](https://docs.rs/git2/latest/git2/)
- [git2：組み込み・SSH・HTTPS の feature](https://docs.rs/crate/git2/latest/features)
- [git2：SSH 認証 API](https://docs.rs/git2/latest/git2/struct.Cred.html)
- [Tauri：WebView から Rust を呼ぶ仕組み](https://v2.tauri.app/develop/calling-rust/)

外部コマンドを使う方針は会話中に取り下げた。実装では内蔵ライブラリを利用する。


## 初期実装の進捗（2026-10-12）

- native：実フォルダの選択、snapshot 保存・再読み込み、外部変更と古いリビジョンの拒否。
- 内蔵 Git：init / status / diff / stage / commit / log、clone / fetch / push、fast-forward pull。
- desktop UI：Menu → Git、ファイル選択によるコミット、公開鍵表示、Shell の基本 git コマンド。
- SSH：Rust の `ssh-key` で Ed25519 を生成し、パスフレーズ必須で暗号化保存。libssh2 のメモリ認証を使用。
- native のパスフレーズ入力は macOS で実装。Windows/Linux は安全な入力が実装されるまで SSH 操作を拒否。
- 鍵は現在一つだけ管理し、既存の鍵の上書き・インポート・システム ssh-agent の利用はしない。
- ホスト鍵は初回に native で確認し、登録後の変更は拒否。remote 設定と認証先も native に表示する。
- キャンセルはチェック地点での通信中断要求であり、即時停止や完了済み push の取り消しではない。
- 検証：テキスト/バイナリ同期、ローカル Git、内蔵 transport の fetch/push/fast-forward、暗号化鍵、
  一時 SSH サーバーへの内蔵 libssh2 認証、配布 Web 本体を使った UI と Shell の接続、
  macOS アプリの secure input 表示・キャンセルと公開鍵未生成の応答。
- 未確認：実際の Git ホスティングサービスでの clone/fetch/push、他OSの実機動作。
- 制限：linked worktree・シンボリックリンク・hard link・外部 workdir・非UTF-8パス・merge/rebase・LFS・submodule・署名は未対応。
  保存はファイル単位の一時ファイル/rename と可能な範囲のロールバックで、全ファイルのクラッシュ時原子性は保証しない。

実装・利用方法は `w/tetorica-fm2612-playground-tauri/README.md` の「内蔵 Git（開発中）」を参照。
上流の配布 Web ファイルと `release.lock.json` は変更せず、desktop 専用モジュールを追加している。

## 方針変更：Cassette Git と native HTTPS（2026-10-12）

会話で、SSH 方式から HTTPS＋トークン認証へ変更した。現在の方針は以下。

- ローカルの init / status / diff / add / commit / log は `isomorphic-git` で JavaScript に統一する。
- `tetorica-virtual-files/git` を独立した import として提供し、`/.git` を Virtual Files 内に持つ。
- Export Cassette に `.git` を含め、Import で作業ファイルと履歴を復元する。New Cassette は両方を消す。
- Browser 版はローカル操作のみ。clone / fetch / pull / push の通信は提供しない。
- Tauri の push / fetch / fast-forward pull は、isomorphic-git の HTTP client を IPC 経由で Rust に接続する。
- Rust は HTTPS と native secure input を担当する。トークンは操作単位の native メモリに置き、
  WebView・Cassette・ディスクには保存しない。現在の secure input は macOS のみ。
- 承認済みリポジトリの Git HTTPS endpoint に通信を限定し、redirect を拒否する。
  push の送信パケットも native で確認した commit と branch に一致することを検証する。
- 前の実フォルダ方式は import から履歴を Cassette にコピーできる。元の実フォルダを変更しない。
- SSH 鍵は新方式では使用しない。既存の鍵・実リポジトリは削除しない。
- Git 操作は隔離 snapshot で実行し、編集の競合・New/Import・キャンセルで古い snapshot を反映しない。
- 検証済み：ローカル Git、binary/deletion、履歴入り Cassette の往復、New での履歴消去、
  native HTTPS の IPC と push protocol fixture、URL/endpoint/commit/branch の制限。
- 未確認：新方式での GitHub への実際の認証と push、他OSの native secure input。

これ以降は、この節を現在の仕様とする。旧 SSH 方式の節は初期実装の記録として残す。

## 名前付き PAT の native 保存（2026-10-12）

- Menu → Git の Personal access tokens から、名前付き PAT の登録・選択・更新・削除を行う。
- PAT 本文は macOS Keychain に保存する。入力は native secure text field で行い、JavaScript／IPC に値を渡さない。
- JavaScript に公開するのは名前・ID・HTTPS host・現在の選択 ID のみ。秘密を読み出す API は提供しない。
- アプリの private metadata に名前と ID、host、repository URL → token ID の選択を保存する。
- native の接続先確認を経てリポジトリごとに選択する。Cassette からの token ID 指定は認めない。
- push / fetch / pull は native が保存済み PAT を取得する。毎回の PAT 入力を廃止する。
- 登録 host と異なる host への送信を拒否する。更新・削除時には該当トークンの active session を破棄する。
- New/Import Cassette はトークンの登録・接続先の選択に触れない。
- 検証：実 Keychain の dummy credential の保存・読み出し・更新・削除、metadata の再起動時復元、
  host と repository 制限、IPC の secret 値拒否、WebKit で複数選択と管理操作、Cassette に ID を含めないこと。
- 対応 OS は macOS。保存済み PAT を使った実 GitHub push はユーザーの環境で確認する。

## 設定専用メニュー・アプリ共通の選択（2026-10-12）

- ユーザーの指定により、Menu → Git 設定は PAT の登録・選択・更新・削除だけに絞る。
- Git 操作は Shell コマンドで行う。Git 設定画面はプロジェクトの状態を読み書きしない。
- repository URL → token ID の紐付けを廃止し、native metadata に app-wide selectedId を保存する。
- 初回のトークン登録時は自動選択。複数の場合は名前を選んでアプリの使用トークンを切り替える。
- New/Import Cassette とアプリ再起動でも登録と選択を維持する。削除した選択は勝手に別トークンへ切り替えない。
- 旧 metadata のトークンを保ち、唯一の旧選択または唯一の登録から app-wide 選択へ移行する。
- 登録 host の制限は維持する。native で通信先を確認してから Keychain の秘密を利用する。
- 登録名・ホスト・登録ボタンを画面の先頭へ置き、日本語の案内に変更する。
- WebKit で登録ボタンが初期 viewport 内に見えること、操作ボタンがないこと、New Cassette 後の選択維持を確認。

### Git 通信時のトークン選択（2026-10-12）

- 設定画面はトークンの登録・削除のみ。「使う」「更新」のボタンを廃止。
- push/fetch/pull の native 確認画面でホストに合う保存済みトークンを選択する。前回の選択を初期値にする。
- PAT の差し替えは削除・再登録で行う。登録したトークンは次の通信時の初期値になる。

### Windows／Linux の資格情報ストア（2026-10-12）

- Windows：Credential Manager に keyring/windows-native で保存。Win32 のパスワード入力欄とトークン選択画面を使う。
- Linux：keyring/sync-secret-service＋crypto-rust で Secret Service に保存。GTK のパスワード入力欄と選択画面を使う。
- Linux の保管庫未導入・未起動・ロック時は案内を返し、平文保存にフォールバックしない。
- JS へ返すのは名前・ID・ホスト・保存先の表示名だけ。PAT 本文は native 側のみで扱う。
