# PC-98（YM2608）のNative対応

2026-10-22。Web Audioを既定のまま、TauriのNativeエンジンでPC-98 modeを選べるようにする。

## 対応範囲

- Browser/WASMと同じymfmのYM2608を直接C++で生成する。FM 6CH、SSG 3CH、リズム6音、ADPCM-Bを扱う。
- 既存の`fm`／`ssg`／`rhythm`／`adpcm`、`play()`、`await useSoundChip('ym2608')`を使える。共有ハンドルには同じ3セクションを持たせる。
- 標準clockは現在のWeb版と同じ8,000,000 Hz。`await fm.setClock(hz)`とWorkerのclock要求に対応する。
- 8 KiBのプロジェクト製リズムROMと2 MiBのADPCM-B RAMを生成時に確保する。外部ROMとサンプルの転送も扱い、音声callback内では確保・解放しない。
- ADPCM-BのPCM変換には既存のエンコーダーを使い、Sample Editor／PC98サンプラーから接続する。圧縮音声のデコードは読込み時のWeb側で行う。
- MainとWorkerの時刻付き演奏命令・所有者取消しを扱う。転送準備は即時に行い、Workerのperformance／owner情報を保持する。
- Keyboard／OperatorsはFM・SSG・リズム・ADPCM-Bの対象を選べる。手動押下をチャンネル単位で保護し、古いキー解放や別ownerの取消しで新しい音を止めない。
- 状態取得は適用済みレジスターを読み取り、先読み中のJS状態を上書きしない。観察で音声を進めたり、IRQ状態を消したりしない。
- 共通ミキサー・FX・liveFx・monitor・最終出力録音へ接続する。再生中のPCMをWebViewへ転送しない。
- Stopは発音と古い予約を止め、clock・音色設定・ROM／RAMを保持する。resetもBrowser版と同じくメモリーを保持する。

Nativeの対象追加はYM2608のPC-98 modeのみ。PC-98（YM2203）、Neo Geo、独立した追加チップは既存のWeb Audio経路を使う。
Native IPCの状態読取りは非同期で、C++音源内部の読取り・PCM生成は同期のまま保持する。

## ソースと配布

共通ymfmはTauriの`src-tauri/native-genesis`を共有し、新しいラッパーを`native_genesis_ym2608.cpp`に置く。
`native-ym2608`にはWASM原典・プロジェクト製ROM・ハッシュ・原典情報を保存し、`sync_native_ym2608.py`で確認する。
GNUリンカー向けに、YM2608ラッパーを共通ymfmライブラリーより前へ配置する。配布物にymfmのBSD通知を含める。

## 検証

- Native／WASMのPCM比較は44.1／48／96 kHzでFM・SSG・rhythm・ADPCM-B、mute、clock、Stop／resetを確認する。
- Rustでは予約・取消し・古いsession・manual lease・転送上限・保持データの寿命・共通FX／録音を確認する。
- JSでは既存APIとのレジスター列一致、Mainと実MessagePortを使ったWorker、非同期読込みの取消しを確認する。
- Chromium／WebKitではPC98の初期コード、Keyboard・Operators・サンプル、mode／engine切替を確認する。Native IPCは模擬し、実音声デバイスは開かない。

### 2026-10-22の結果

- JavaScript全体: 3,239件成功、失敗・skipなし。Main／実MessagePort経由のWorker、Stop後のSSG音量・エンベロープ復元、試奏の解放、clock通知の二重送信防止を含む。
- Rust全体: 183件成功、失敗なし、既存の実デバイス等の4件はignored。PC98用の13件で予約・所有者・転送上限・実PCM・ミキサー／FX／録音を確認した。
- macOS ARM64のNativeと配布済みWASMを44.1／48／96 kHzで比較し、30ケース・184,320ステレオフレームの最大差は0。音声callback内の確保・解放も0だった。詳細は[native_pc98_pcm_validation.json](native_pc98_pcm_validation.json)。
- Linux ARM64（Ubuntu 24.04、GCC 13.3、GNU ld 2.42、C++14）でも同じ30ケースの最大差は0。静的ライブラリーの順序による未解決参照を再現し、実際のbuild.rsと同じラッパー→共通ymfmの順序でリンク・実行できた。詳細は[native_pc98_linux_arm_pcm_validation.json](native_pc98_linux_arm_pcm_validation.json)。
- Chromium／WebKitで既存Native経路の回帰確認を実施。最終Tauri配布データでもPC98のMain／Worker、FM／SSG／リズム／ADPCM-B、サンプル転送、Keyboard／Operators、Stop後の設定・メモリー保持、mode切替が成功した。Native IPCは模擬している。
- ソースは専用4ファイルと共有ymfm 11ファイルのハッシュを確認。Tauriへの827ファイルの取込みと整合性検査、最終データを含む`cargo build --offline --locked`も成功した。

取込みZIPのSHA256は`6eb4254712ae9dea92cfb7df06e7810032ce5abff76626b9ceff4f07c7a0f243`。
実音声デバイスを開く試験・聴感確認と、今回の追加分のWindows／MSVC実機ビルドは未実施。
変更はローカルに反映済みで、公開・コミット・pushは行っていない。
