# TauriのNative Genesis音声バックエンド

2026-10-21。OS再起動でYM2612 Playgroundの断続的ノイズが消えた。同じYM2612を
ネイティブ生成するMIDI Playgroundでは発生しなかったため、音声生成から出力までを
ネイティブ側で完結させる構成を、Genesisに絞って比較できるようにする。
構造差は調査の根拠であり、今回のノイズ原因やNativeでの解消が確定したわけではない。

## 合意した方針

- **安定するまではWeb Audioをデフォルトにする。** Nativeへの自動切替はしない。
- Tauriの設定からWeb Audio／Nativeを選べる。Nativeは試験機能として表示する。
- ブラウザー版は引き続きWeb Audioを使う。演奏API・音色・ユーザーコードを共通化し、
  同じテストシナリオを両バックエンドで実行できるようにする。
- 最初の対象はGenesisのYM2612＋Sega PSG。他modeの一斉移行は行わない。
- 現行AudifyはWeb Audioで生成したPCMを転送する出力先であり、今回のNative生成と区別する。
  Native生成はAudioWorklet／WebSocketによるPCM転送を経由しない。

## 実装の境界

ブラウザーの既存APIからレジスター命令を作る部分は共有し、生成バックエンドを注入する。
Native側はチップ状態、デバイスの音声フレーム、時刻付き命令キュー、PCM生成・変換、
ミックス、音量、停止フェード、デバイス出力を所有する。
JS側との境界は命令と状態に限定し、通常再生中のPCMを行き来させない。

既存のPlayground用C++ラッパーと音源コアをネイティブビルドする。
MIDI版のCPAL出力・キュー所有の構造は参考にするが、MIDI音声割当てや小さい音源ブリッジを
そのまま流用しない。物理6CH・レジスター操作と既存の音源コアを共有するため。
コア内のtimerは音声生成とともに進むが、初期実装では同期status読取・IRQ観測を公開しない。

RuntimeにはAudioContextと区別した音声clockの入口を設ける。
NativeをAudioNodeの偽物として接続せず、Web Audio固有の処理と明示的に分ける。
Native未対応の機能は理由を示して拒否し、別バックエンドで同時に鳴らしたり、
音が出たように扱ったりしない。初期段階のWorker・追加チップ・FX・サンプル等の対応範囲は
実装状況の欄に記載する。

## 設定とライフサイクル

- エンジン切替は演奏停止・旧セッション解放の後に行う。実行中に音声経路を継ぎ替えない。
- Nativeは明示選択された時だけデバイスを開く。起動時のWeb Audio利用はNativeを初期化しない。
- session IDで古いRun・非同期応答からの命令を拒否する。
- 命令キューとバッチ長に上限を設け、満杯時に黙って音符を捨てない。
- 停止は未来の命令を消去して短いフェードを行う。終了時はストリームとチップを解放する。
- mode変更・開始失敗・再読み込み・ウィンドウ終了で後始末する。
- Native未対応modeを選んだ場合の有効エンジンはWeb Audioとし、画面にも明示する。
  Nativeの初期化失敗時も再生失敗を表示し、明示的に切り戻せるようにする。

## 検証

- Native PCM生成を物理デバイスなしで実行し、音源・左右・音量・reset・時刻付き命令・
  停止・バッファー上限を確認する。
- 共通の音色／演奏コードを用い、JS側の命令・時刻・生命周期を共通テストで確認する。
- 設定の既定値、切替、未対応mode／機能、失敗、旧セッション解放をブラウザーで確認する。
- 通常のWeb Audio経路と既存Genesisテストを回帰確認する。
- 実デバイスでの長時間試聴・再発有無は自動テストと分けて記録する。
  TauriのWeb Audio経路でも、Safari／Chrome固有の確認を完全には代替しない。

## 実装状況

- [x] 独立したNative Genesis生成・CPAL出力のコードと、デバイスを使わない検証。
- [x] 共有Runtimeのclock／backend境界とNative Synth。
- [x] Tauriのエンジン設定・ライフサイクル接続の実装。
- [x] 共通Runtime／KeyboardのJS回帰、Nativeコアと実WASMのPCM比較。
- [x] Tauriへの共有アセット取り込み、ハッシュ検査、offlineビルド。
- [x] 実装した機能・制限・検証結果の追記。
- [x] ブラウザーによる設定UI、切替、保存プロジェクト引継ぎの統合検証。
- [ ] Tauri実デバイスでの再生、切替、長時間試聴とノイズ再発有無の確認。

実装と自動検証まで完了。Chromiumの共有ページとWebKitの配布用アセットで設定UIの
統合検証も成功した。画面テストのNative IPCは模擬し、実際のCPAL機器の起動・停止は
別の無音テストで確認した。音の試聴・長時間安定性・今回のノイズ解消は未確認。

### 利用方法

1. 更新したTauri版でGenesis modeを選ぶ。
2. **Menu → Audio engine…** を開き、**Native Genesis (experimental)** を選んで
   **Apply engine**。演奏を停止し、現在のプロジェクトを保存・引き継いでページを再読み込みする。
3. **Run** またはKeyboardの試聴操作でNative音声を開始する。設定を開くだけではデバイスを開かない。
4. 切り戻す場合は同じダイアログで **Web Audio (default)** を選んで **Apply engine**。

選択はURLの `audioEngine=native` で明示し、グローバルな永続設定には保存しない。
この指定のない通常起動はWeb Audioになる。同じURLの再読み込みでは指定が維持される。
ブラウザー版およびGenesis以外のmodeではNativeを使用せず、有効なエンジンはWeb Audioと表示する。
Native初期化失敗を自動フォールバックで隠さず、エラーを表示して設定から切り戻せる。

### 初期実装の対応範囲

| 機能 | Native Genesis | 補足 |
| --- | --- | --- |
| Genesis／YM2612 6CH＋Sega PSG | 対応 | チップ生成・変換・ミックス・CPAL出力をNative側で完結 |
| `fm`／`play`／`liveLoop`、Main実行 | 対応 | 既存の音色・音楽APIとレジスター生成を共有 |
| FM／PSGレジスター、時刻付き書込み | 対応 | 同時刻は送信順。IPCは直列化し、1バッチ4096命令・待機65536命令を上限にする |
| `useSoundChip('ym2612')`／`useSoundChip('segapsg')` | 対応 | 既存の主音源を借用。追加インスタンスは作らない |
| ミキサー、master音量、画面の試聴音量 | 対応 | ミュート・solo・panに対応。演奏側音量と試聴音量を分離 |
| Stop／終了／旧セッション破棄 | 対応 | 未来の命令を破棄して短いフェード。FM音色・PSGの周期等を保持し、発音を停止 |
| KeyboardのChip／CH選択、Guitar／PCキー | 対応 | 共通のKeyboard routingを使用。ブラウザーUIでFM／PSGのPCキー操作と発音・解放命令を確認 |
| FM Operatorsの編集情報 | 設定値を共有 | JS側の設定値であり、Native内部のエンベロープ等の適用済み観測ではない |
| PSGの適用済み音色情報 | 未対応 | 読取要求を明示的に拒否。KeyboardのPSG試聴は別途対応 |
| 手動KeyboardとscriptのCH優先制御 | 未対応 | 同じ物理CHへのscript書込みは手動の長押しを上書きし得る。演奏中は空きCHを選ぶ |
| Worker、追加チップ、Genesis以外のmode | 未対応 | Web Audioを使用。Native選択中の未対応APIは理由を示して拒否 |
| DAC／sample／stream／Web Audio noise、FX | 未対応 | 別の音声経路で代用しない |
| 音声記録、Audio diagnostics、独立した音色ファイル試聴 | 未対応 | Web Audioへ切り戻して使用 |
| Chip clock変更、同期status／IRQ読取 | 未対応 | 固定のYM2612／PSG clockを使用。コア内timerの進行とは区別 |

Native用にAudioContextやAudioNodeの偽物を作らない。Native Synthは明示的な音声clockと
admin adapterを持ち、Keyboardの操作もPCMの転送や追加AudioWorkletを経由しない。
clockは開始・再開時のNative応答を基準にホストの単調時刻で補間する初期構成であり、
デバイスclockの継続的なドリフト追従やデバイス交換時の自動復旧は今後の検討事項。

### 検証結果（2026-10-21）

| 検証 | 結果 |
| --- | --- |
| 共有Runtime／Native Synth／KeyboardのNodeテスト | 152件成功 |
| Tauri IPCを含む実行ガードのNodeテスト | 18件成功 |
| Tauri Rustテスト | 30件成功、3件ignored。Native Genesisの9件を含む。既定では資格情報2件と実デバイス1件を実行しない |
| CPAL実デバイスの無音確認 | 明示実行で1件成功。既定機器を開き、clock進行・命令処理・Stop・shutdownを確認。発音・録音は行わない |
| Tauri側 `npm test` | Python 8件、Node 31件成功 |
| 実Native／実WASMのPCM比較 | 44.1／48／96kHz × FM／混合・resetの6ケース成功。最大絶対差は4×10⁻⁹未満 |
| Native音源スナップショット | 16ファイルの由来・ハッシュ一致 |
| Tauri取り込みアセット | 781ファイル。archive SHA-256は `61d6023b52b13c33e964f584ad30da5ed4f9b5d25e10e76d73d369c5f972da3a` |
| Tauri `cargo build --offline --locked` | 成功 |
| Chromium／WebKitの設定UI統合検証 | 成功。Chromiumは共有ページ、WebKitは配布用アセット。Native IPCは模擬 |
| 実デバイス試聴・長時間安定性 | 未実施 |

共有JS側では遅延したIPC応答でもpreset→周波数→key-onが順序を保つこと、
Stop後に古い待機命令が流れないこと、JS側の送信待ちとNative側のキュー双方が有界であること、
FM／PSGの古いKeyboard key-offが新しい長押しを止めないことを確認した。
Stop後に同じFM音色を再設定せずkey-onだけで鳴らせることもNativeの実コアで確認した。
実デバイスの無音テストでは、開く前にidle／mute-rampのPCMが0であることも確認している。
このテストは接続とライフサイクルの確認であり、実際の音の試聴や長時間安定性の確認ではない。
画面テストでは、Web Audio既定・Native選択だけでデバイスを開かないこと・プロジェクトの引継ぎ・
Native時にAudioContext／AudioWorkletを生成しないこと・Stop後の同一セッション再利用・
KeyboardのFM／PSG発音命令・開始失敗の表示と手動切戻し・mode変更時の解放を確認した。
開始失敗時にLoading表示が残る問題をこの検証で見つけ、Runのエラーを画面に表示するよう修正した。

再実行コマンド。上流のこのリポジトリーでは次を使う。

```sh
node --test web/native_genesis_synth.test.mjs web/playground_runtime.test.mjs docs/playground/playground_keyboard_routing.test.mjs docs/playground/playground_mode_keyboard.test.mjs docs/playground/playground_execution.test.mjs
```

Tauriリポジトリー `w/tetorica-fm2612-playground-tauri` を作業ディレクトリーとして次を使う。

```sh
npm test
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml
node scripts/check_native_genesis_core.mjs ../..
python3 scripts/sync_native_genesis.py --check --source ../..
python3 scripts/import_release.py --check
```

実デバイスの無音確認だけを明示実行する場合（通常テストでは実行しない）:

```sh
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_genesis::tests::native_device_silent_smoke -- --ignored --exact --nocapture --test-threads=1
```

UI検証は、上流リポジトリーで次を実行する。Native IPCを模擬して共通ページを操作し、
実デバイスは開かない。したがって、この検証が通っても実デバイス試聴の代わりにはならない。

```sh
node scripts/check_playground_native_backend_browser.cjs
node scripts/check_playground_native_backend_browser.cjs --root=w/tetorica-fm2612-playground-tauri/dist
```
