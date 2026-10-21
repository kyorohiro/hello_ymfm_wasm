# Game Boy・SNES・PC Engine のNative対応

2026-10-22。TauriのNativeエンジンへ3モードを追加する。Web Audioは既定のまま。

## 実装

- Game Boyは現在のMAME Game Boy APU、PC Engineは現在のMAME HuC6280を直接C++でビルドする。別の音源実装へ置き換えない。
- SNESは既存SNES_SPCのS-DSPを直接ビルドする。BRR用64 KiB RAM、8声、ADSR／GAIN、noise、pitch modulation、echo／FIRを扱う。
- 出力sample rateへの変換とclock変更は現在のBrowser版と同じ手順・Float32丸めを使う。
- Main／Workerの主音源、`useSoundChip`、KeyboardのChip／CH選択、Operatorsの編集・試聴へ接続する。音声データをWebViewへ毎フレーム送らない。
- JavaScriptは既存の高級APIからレジスター命令を生成する。音源生成はCPAL callback内のC++で行い、AudioContext／AudioWorkletを作らない。
- 適用済みのNative状態と未来の予約を含むJS状態を分ける。UIの読取りで予約状態を上書きしない。手動試聴は音声側のCH leaseで保護する。
- Stopは発音・古い予約を止め、波形／サンプルRAM・設定・clockを保持する。resetの初期化動作は各Browser APIに合わせる。
- SNESのkeyOn／keyOffはNative側で実行する。未来の複数CHのKON／KOFFをJSの古いmaskから生成しない。
- SNESはキャプチャ済みDSP／RAM timelineも準備・再生・停止できる。再生完了待ちでWorkerの命令列を塞がない。
- 3モードとも共通ミキサー・FX／liveFx・noise／sample・master・停止fade・最終出力monitor／録音を通す。

独立音源の追加と、SPC700 CPUを実行するSPCファイルプレーヤーは引き続きWeb Audioを使う。
ファイル選択・マイク入力・圧縮音声のデコードは既存のWebView側で行う。

## 原典・ライセンス

Tauriの`src-tauri/native-gameboy/`、`native-huc6280/`、`native-snes/`に、原典ソースとハッシュ、ライセンス、ビルド手順を保存する。
Game Boy／HuC6280はBSD、SNES_SPCはLGPL-2.1。アプリのresourcesへライセンスを追加する。
SNESの対応ソース・C ABI wrapper・offline fixture・再ビルドスクリプトは、アプリのresourcesにも同梱する。
アプリ全体の再リンクはTauriリポジトリーのCargo/build.rsから行う。

## 検証

PCM比較は実際のNative C++と既存WASMを、音声デバイスを開かずに比較する。
44,100／48,000／96,000 Hz、複数のcallback分割、音色・波形・RAM・noise・停止を対象にする。

```sh
node scripts/check_native_gameboy.mjs --out /private/tmp/native-gameboy-pcm.json
node scripts/check_native_huc6280.mjs --out /private/tmp/native-huc6280-parity.json
node scripts/check_native_snes.mjs --out /private/tmp/native-snes-parity.json
node --test web/native_genesis*.test.mjs web/playground_runtime.test.mjs
node scripts/check_playground_native_backend_browser.cjs --consoles-only --out=/private/tmp/native-consoles-browser
```

Tauriリポジトリーで各`sync_native_{gameboy,snes,huc6280}.py --check --source ../..`、
`import_release.py --check`、offlineのCargoテストとビルドを確認する。
Browserの操作確認ではNative IPCをmockし、実機での聴き比べとは区別する。

## 結果

- Game Boy: 42ケース／396,912ステレオフレーム、最大差0。
- PC Engine: 39ケース／239,616ステレオフレーム、最大差0。
- SNES: 42ケース／442,368ステレオフレーム、最大差0。BRR／8声／noise／echoとキャプチャ済みtimelineを含む。
- 3コアともrender・制御・Stop等の検査区間でC++のメモリー確保／解放0。
- JavaScript全体: 3,201件成功。実際のMain／WorkerのGame BoyセクションをKeyboard／所有権guardで使う回帰テストを含む。
- Rust全体: 151件成功、失敗0、実機デバイス等のテスト4件ignored。
- Chromium／WebKitの全体回帰と、配布用データの3モード確認が成功。Main／Worker、初期コード、全18CHのKeyboard、Game Boy／PC EngineのOperators、Stop後の波形／RAM保持、SNES timelineを確認。Native IPCはmock、Native経路のAudioContext／AudioWorklet生成0。
- 原典の検証: Game Boy 5ファイル、HuC6280 6ファイル、SNES 31ファイル。SNESの同梱ソースだけでstatic archiveとoffline fixtureを再ビルドし成功。
- Tauriのoffline・lockedビルド成功。
- Tauriへ814ファイルを取り込み、配布データSHA-256 `ba36113cd39921714b86bf6963e24bbbbb05b1bfd526fce6da7fc65eb226fd20` を検証。

PCM詳細は[検証データ](native_consoles_validation_20261022.json)に保存する。
実機の出力デバイスを使う発音・聴き比べは今回の自動検証に含めない。
