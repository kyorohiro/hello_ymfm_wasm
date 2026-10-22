# Master System Native対応

2026-10-22。既存のMaster System modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

- Sega PSG：tone 3声＋noise 1声、3,579,545 Hz、モノラル。
- YM2413 OPLL：3,579,545 Hz、9 FM声、または6 FM声＋5 rhythm音。ROM楽器と共有User音色を使う。
- 既存の`psg`／`opll`、`useSoundChip('segapsg')`／`useSoundChip('ym2413')`をMain／Workerから使う。隠れたYM2612は作成しない。
- チップ別ミキサーから共通FX／liveFx・monitor・録音へ接続する。

## 操作と状態

既存のKeyboardで音源とチャンネルを選び、Sega PSG／YM2413のOperatorsでも編集と試奏を行う。
手動試奏中は対象の物理チャンネルをコード側の発音から保護する。PSGのTone 3依存noise、OPLLの共有User音色・rhythmの物理チャンネル共有も考慮する。
適用済み状態は要求時に非同期で取得し、UIの描画周期に音声生成を結び付けない。Workerには命令・状態だけを送り、再生PCMは通さない。
Stopは発音・予約・試奏を止め、PSGのperiod／noise／最後に鳴らした音量とOPLLの音色・clockを保持する。PSGは停止中の出力を無音にし、次のkeyOn／試奏で最後の可聴音量を復元する。取消した未来の音量変更は次の発音へ持ち越さない。

## 実装と検証

C++音源は既存Web／WASMと同じSegaPSGとymfm OPLLを使用する。
原典・ハッシュ・生成手順はTauriの`src-tauri/native-master-system/`へ記録する。共有providerの重複コンパイルを避け、GNUリンカー向けの依存順も維持する。

OPLLのresetは、Web版が音源を作り直す際の内部カウンターまで一致させるため、構築時に確保したpower-on snapshotをcallback内で復元する。音声callback内で音源の作成・破棄やメモリー確保を行わない。

OPLLのRhythmモード変更時だけ、更新後の状態からKeyboardの選択肢を9 FM声／6 FM声＋5ドラムへ切り替える。通常のドラム発音のたびに選択肢を更新しない。

### 検証結果

- JS全体：3,868件成功、1件skip。Master System固有の36件を含む。
- Rust全体：226件成功、4件ignored。Master System固有の14件を含む。
- 実配布WASMと実Workletの生成結果を、Native C++の独立PSG／OPLL出力と比較。44.1／48／96 kHzの60ケース、368,640出力フレームで最大差0。詳細は[native_master_system_pcm_validation.json](native_master_system_pcm_validation.json)。
- C++ fixtureでStop／reset、PSGラッチ・noise・clock、OPLLリズム共有・試奏の再発音と取消しを確認。チップcallback内の確保・解放は0。同じ全PCMケースをAddressSanitizerでも検証した。
- Chromium／WebKitで初期コードのMain／Worker、PSGの4声・OPLLの9 FM声と5ドラムのKeyboard、Guitarのマウス入力、各音源タブのPCキー試奏、User音色編集、独立ミキサー、Stop保持、mode切替が成功。既存NativeモードとWeb Audioの回帰確認も成功。Native IPCは模擬している。
- 原典12ファイルと共有provider 9ファイルのハッシュを検証済み。

最終Tauri配布データでもChromium／WebKitのMaster System操作確認が成功した。
830ファイルを取り込み、`import_release.py --check`で整合性を確認した。
取込みZIPのSHA256は`1e232e82d041af1d278744bc6caff9f48562a9f8d57034a0c14939677eb40942`。

最終配布データを含む`cargo build --offline --locked`も成功した。
変更はローカルへ反映済み。公開・コミット・pushは行っていない。

macOS ARM64で検証した。今回のWindows／Linuxの実ビルド、および実音声デバイスでの聴感確認は未実施。
