# TauriのNative Genesis音声バックエンド

AudioタブのEnvelope／Waveform／Spectrumは、[Native Audioモニターの作業記録](native_audio_monitor_01.md)を参照。
表示中だけ観測用データを取得する方式で対応した。
`noise.create()`のNative生成は、[Native noiseの作業記録](native_noise_01.md)を参照。
QuickJS-NGによる`liveFx`も[Native再生へ接続した](native_livefx_01.md)。使用中だけ専用workerと
2048フレームの先読みを使い、未使用時はJS実行環境を作らず直接出力する。
Mega CDのRF5C164も[Native対応した](native_megacd_01.md)。Genesisと同じ最終出力経路へ混ぜる。
DX7 modeも[Native対応した](native_dx7_01.md)。MSFA音源を直接ビルドし、共通の最終出力へ接続する。
NES＋FDSも[Native対応した](native_nes_01.md)。現在のJS音源をC++へ移植し、共通の最終出力へ接続する。
PC-98のYM2608も[Native対応した](native_pc98_01.md)。FM／SSG／rhythm／ADPCM-Bと共通のKeyboard・Sample Editorを使う。
Neo GeoのYM2610／YM2610Bも[Native対応した](native_neogeo_01.md)。4／6CH FM・SSG・ADPCM-A/Bと既存サンプラーを使う。

## 第2段階：Genesisの実用機能を増やす

2026-10-21、未対応機能を順次追加する指示を受け、次を進める。
第1段階のWeb Audio既定・Native明示選択・PCMをUIへ毎block転送しない方針を維持する。

- [x] Worker実行。共通Workerの音楽APIと実際のMessageChannelを使い、Nativeへ時刻付き命令を送る。
  Worker lookaheadとloop ownerの取消しを維持し、停止済みloopの未来の命令を残さない。
- [x] 生のDAC書込み、`fm.dac`のPCM登録・再生とDAC bankの再生。
- [x] 汎用サンプルの登録・再生。初期の入力形式を明記し、PCMの保持・音声voice数に上限を置く。
- [x] 組込みFXとbranch／parallel／setChain、パラメーター変更・tempoをNativeに接続する。
  既存C DSPを共有し、構築時のmalloc／freeや最後の所有参照の解放を音声callbackへ持ち込まない。
- [x] Native最終出力の明示的な録音。先にバッファーを確保し、終了時に一度だけ受け取る。
- [x] 共通API、Native実コアとWASMの差分、Worker／UI／失敗・停止・取消しの回帰検証。

全mode・追加チップの一斉対応は引き続き行わない。任意のJavaScriptを実行する
`liveFx`は専用workerへ分け、Web Audio固有オブジェクトは持ち込まない。
以下の対応表は第2段階の実装を反映する。第1段階の検証結果は履歴として残す。

### 第2段階の仕様

Workerは既存の音楽APIをそのまま使い、Mainと同じNativeセッションへ時刻付き命令を渡す。
lookaheadは共通設定を使用し、通常0.5秒。FM／PSG／DAC／sample／FXが同じフレーム時刻を使う。
loopごとのownerを記録し、取消しではそのloopの未来の命令と、まだ所有している発音だけを止める。
別loopや手動入力で置き換わったCHを、古いloopの後処理で止めない。
明示時刻のDAC命令・準備・即時入力にも演奏のsession／ownerを付ける。異なるMessagePortから
遅れて届く古いStopの後処理を、次のRunの命令として受け付けない。Main上のbridgeも
待機・送信中を合わせて65536命令／2048メッセージ／保持データ64 MiBに制限する。

`sample.load`はmono／stereoのPCM、AudioBuffer互換オブジェクト、WAVのbytes／Blob／同一origin URLを
受け付ける。FLAC／MP3等はブラウザーが対応する形式を、読込み時だけOfflineAudioContextでPCMへ変換する。
通常のAudioContextやAudioWorkletを作らず、再生はNative側で行う。PCM／Float WAVは直接読み取る。
Web Audio版と共通のSonic Pi alias変換を使い、`sonic-pi/ambi-choir`等の同梱FLACも扱う。
再生はrate、逆再生、loop、offset／duration、pan、fadeに対応。
NativeはPCMとDACを含むbankを64 MiB以内に保持し、サンプルvoiceの予約を64件までに制限する。
終了・取消しで使い終わったbankやFX graphの最後の参照は制御側で回収する。

FXは既存のC DSPと同じ13種類を使う。直列／branch／parallel、パラメーター変更とramp、tempo同期に対応。
音声callback内ではgraphを構築しない。構成変更は制御側で準備し、5msで出力を切り替える。
パラメーター変更はDSPの履歴を保持するが、`setChain`／clearで構成を組み直すとdelay／reverbの履歴は初期化する。
`noise.create()`は既存のC DSPをNativeでも共有する。`liveFx`はC FXの後段に接続する。
使用中だけ48kHzで約42.7msの遅延が加わり、処理が間に合わなければ同時刻のdry音へ戻す。

**Menu → Audio diagnostics…** はNativeでも使用できる。FM／PSG／PCMとFX・音量を適用した
最終ステレオ出力を、最大30秒／32 MiBまで明示的に記録する。終了時だけPCMを受け取り、
output WAVとJSONを保存できる。Nativeではchip単独WAVは保存しない。
この記録はCPALの機器別形式変換・monoへの合成・OSミキサーより前のPCMであり、
実際に機器が鳴らした音やデバイスのdropoutを直接録音するものではない。

第2段階でも実デバイスの長時間試聴・ノイズの再発確認は別途必要。通常再生中に生成PCMを
JavaScriptへ転送する経路や追加AudioWorkletは作っていない。

### 第2段階の検証（2026-10-21）

| 検証 | 結果 |
| --- | --- |
| 共通Runtime／Native Synth／media／FX／Worker／Keyboard／設定／診断UI／実行ガード | Node 243件成功 |
| Tauri Rust | 48件成功、3件ignored（資格情報2件・物理デバイス1件）。FX 6件を含む |
| 実Nativeと実WASMのFM／PSG比較 | 44.1／48／96kHz、6ケース成功。最大差3.73×10⁻⁹ |
| 実Rust schedulerと実WASMのDAC／packed stream／逆再生・loop・fade付きPCM比較 | 同3種の出力rate、9ケース成功。最大差1.49×10⁻⁸ |
| 13種FXと直列／並列構成の実Native／実WASM比較 | 同3種の出力rate、42ケース成功。最大差1.49×10⁻⁸ |
| Tauri側の既存テスト | Python 8件、Node 31件成功 |
| Tauri取り込みアセット | 784ファイル。archive SHA-256 `3e1eab7ca56d3ff12dd5fde0edd4277af87ff9a1bfdfab75363d6f49382b74f6` |
| 配布アセット上のChromium／WebKit | Main／Worker、DAC／sample／FX、loop取消し、録音WAV保存、Stop／Run、切替・開始失敗・mode変更が成功。Native IPCは模擬 |
| Tauri `cargo build --offline --locked` | 更新した配布アセット取り込み後に成功 |
| 物理デバイスの試聴・長時間安定性 | 第2段階では未実施。音声デバイスを開くテストも実行していない |

圧縮サンプルの追加修正：同梱FLACを読み込む際の
`Expected PCM/Float RIFF WAV; other formats require decodeAudio`を修正した。
デコードとSonic Pi aliasの解決をWeb Audio版と共通化し、Nativeは読込み時だけofflineデコードする。
元データをデコーダーによるdetachから保護し、Stop後の完了はNativeへアップロードしない。
関連Node 163件、実FLACを使ったChromium／WebKitのMain・Worker検証、配布用アセットのWebKit検証が成功。
Native経路ではlive AudioContext／AudioWorkletを作らず、PCM／WAVの直接読込みではofflineデコーダーも作らない。
更新したTauriアセットは785ファイル、archive SHA-256は
`3bcff79713be5cf5e28d516b6fd18e6e6d29613e80da46a54f470ca57f8e92f8`。

音声デバイスを開かず、実NativeのPCM生成・DSP比較と、IPCを模擬した実ブラウザーのUI検証を
分けて行う。未来のDAC／sample停止が早切れしないこと、owner取消しが手動入力を巻き込まないこと、
旧sessionの遅いcleanup、容量上限、録音開始／終了とStopの競合、FXの連続Run／再評価も検証対象とした。

追加した検証コマンド（Tauriリポジトリーから実行）:

```sh
node scripts/check_native_genesis_media.mjs ../..
node scripts/check_native_genesis_fx.mjs ../..
python3 scripts/sync_native_genesis_fx.py --check --source ../..
```

## 第1段階の方針と実装記録

2026-10-21。OS再起動でYM2612 Playgroundの断続的ノイズが消えた。同じYM2612を
ネイティブ生成するMIDI Playgroundでは発生しなかったため、音声生成から出力までを
ネイティブ側で完結させる構成を、Genesisに絞って比較できるようにする。
構造差は調査の根拠であり、今回のノイズ原因やNativeでの解消が確定したわけではない。

## 合意した方針

- **安定するまではWeb Audioをデフォルトにする。** Nativeへの自動切替はしない。
- Tauriの設定からWeb Audio／Nativeを選べる。Nativeは試験機能として表示する。
- Native選択中のModeは対応modeだけ表示する。現在はGenesis／Mega CD／NES＋FDS／DX7。
  他modeへ移るときは先にWeb Audioへ戻す。非対応modeではNativeの選択肢を無効にする。
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
- 古いURLでNative未対応modeと`audioEngine=native`が組み合わされた場合はWeb Audioを使い、
  URLの無効なNative指定を除く。後からGenesisへ戻っただけでNativeを再選択しない。
  Nativeの初期化失敗時も再生失敗を表示し、明示的に切り戻せるようにする。

Modeの表示制限はChromium／WebKitで確認した。Native中の対応mode限定表示、
Web Audioへ戻したときの全Mode復元、非対応modeでのNative選択拒否、
古いURLの整理後もmode・ソースを保持することを検証した。音声処理は変更していない。

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
2. **Menu → Audio engine…** を開き、**Native (experimental)** を選んで
   **Apply engine**。演奏を停止し、現在のプロジェクトを保存・引き継いでページを再読み込みする。
3. **Run** またはKeyboardの試聴操作でNative音声を開始する。設定を開くだけではデバイスを開かない。
4. 切り戻す場合は同じダイアログで **Web Audio (default)** を選んで **Apply engine**。

選択はURLの `audioEngine=native` で明示し、グローバルな永続設定には保存しない。
この指定のない通常起動はWeb Audioになる。同じURLの再読み込みでは指定が維持される。
ブラウザー版および未対応modeではNativeを使用せず、有効なエンジンはWeb Audioと表示する。
Native初期化失敗を自動フォールバックで隠さず、エラーを表示して設定から切り戻せる。

### 現在の対応範囲

| 機能 | Native Genesis | 補足 |
| --- | --- | --- |
| Genesis／YM2612 6CH＋Sega PSG | 対応 | チップ生成・変換・ミックス・CPAL出力をNative側で完結 |
| Mega CD／RF5C164 | 対応 | 8声・64 KiB RAM。Main／Worker、サンプラー、Keyboard、RFミキサー・clock、最終出力のFX・monitor・録音 |
| DX7／MSFA | 対応 | 16音。Main／Worker、音色・SysEx、Operators・Keyboard。DX7 modeではYM2612／PSGを生成しない |
| NES＋FDS | 対応 | APU 5声＋FDS、DMC RAM、波形・変調・clock、Main／Worker、Operators・Keyboard。NES modeではYM2612／PSG／DX7を生成しない |
| `fm`／`play`／`liveLoop`、Main実行 | 対応 | 既存の音色・音楽APIとレジスター生成を共有 |
| FM／PSGレジスター、時刻付き書込み | 対応 | 同時刻は送信順。IPCは直列化し、1バッチ4096命令・待機65536命令を上限にする |
| `useSoundChip('ym2612')`／`useSoundChip('segapsg')` | 対応 | 既存の主音源を借用。追加インスタンスは作らない |
| ミキサー、master音量、画面の試聴音量 | 対応 | ミュート・solo・panに対応。演奏側音量と試聴音量を分離 |
| Stop／終了／旧セッション破棄 | 対応 | 未来の命令を破棄して短いフェード。FM音色・PSGの周期等を保持し、発音を停止 |
| KeyboardのChip／CH選択、Guitar／PCキー | 対応 | 共通のKeyboard routingを使用。ブラウザーUIでFM／PSGのPCキー操作と発音・解放命令を確認 |
| FM Operatorsの編集情報 | 設定値を共有 | JS側の設定値であり、Native内部のエンベロープ等の適用済み観測ではない |
| PSGの適用済み音色情報 | 未対応 | 読取要求を明示的に拒否。KeyboardのPSG試聴は別途対応 |
| 手動KeyboardとscriptのCH優先制御 | 未対応 | 同じ物理CHへのscript書込みは手動の長押しを上書きし得る。演奏中は空きCHを選ぶ |
| Worker実行 | 対応 | 共通Worker、lookahead、loopのowner取消し。通常のPCM block転送は行わない |
| DAC、`fm.dac`、DAC bank／sample clock | 対応 | PCM登録・pan・時刻指定・packed stream、生のDACレジスター書込み |
| 汎用sample再生 | PCM／WAV＋ブラウザーでデコード可能な圧縮形式 | FLAC／MP3等は読込み時にofflineデコード。rate・逆再生・loop・pan・fade |
| `noise.create()`／`control()` | 5種類に対応 | 共通C DSP、32声まで。Main／Worker、filter、ramp、attack／release、loop取消し |
| 組込みFX | 13種類に対応 | branch／parallel／setChain、パラメーターramp、tempo。構成変更でDSP履歴を初期化 |
| Audio diagnostics | 最終出力に対応 | output WAV／JSON、noise marker。最大30秒／32 MiB。chip単独出力は未対応 |
| AudioのEnvelope／Waveform／Spectrum | 対応 | 左右CH、Pause、共通Yスケール。表示中だけ最大15Hzの観測。FFTは音声callback外で実行 |
| 追加チップ、Genesis／Mega CD／NES＋FDS／DX7以外のmode | 未対応 | Web Audioを使用。Native選択中の未対応APIは理由を示して拒否 |
| JavaScript `liveFx` | 対応 | QuickJS-NG専用worker。使用中だけ2048フレーム遅延。最終出力の観測・録音に反映。FX単位のmonitorは未対応 |
| stream | 未対応 | 別の音声経路で代用しない |
| 独立した音色ファイル試聴 | 未対応 | Web Audioへ切り戻して使用 |
| YM2612／PSG clock変更、同期status／IRQ読取 | 未対応 | FM／PSGは固定clockを使用。RF5C164のclock変更と適用済みレジスターの非同期読取は対応 |

Native用にAudioContextやAudioNodeの偽物を作らない。Native Synthは明示的な音声clockと
admin adapterを持ち、Keyboardの操作もPCMの転送や追加AudioWorkletを経由しない。
clockは開始・再開時のNative応答を基準にホストの単調時刻で補間する初期構成であり、
デバイスclockの継続的なドリフト追従やデバイス交換時の自動復旧は今後の検討事項。

### 第1段階の検証結果（2026-10-21）

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
