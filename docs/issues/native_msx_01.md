# MSX Native対応

2026-10-22。既存MSX modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

- YM2413 OPLL：3,579,545 Hz。ROM楽器・共有User音色、9 FM声／6 FM声＋5 rhythm音。
- AY-3-8910：1,789,773 Hz。3声のtone／noise混合と共有エンベロープ。
- 既存`opll`／`ay`、`useSoundChip('ym2413')`／`useSoundChip('ay8910')`をMain／Workerから使う。余分なYM2612やSega PSGは作らない。
- チップ別ミキサーから共通FX／liveFx・monitor・録音へ接続する。

今回はMSX modeを対象にする。DOS PCとMSX Audioは後続作業とする。

## 状態と操作

既存Keyboardで音源とチャンネルを選び、YM2413／AY-3-8910の各タブでも編集・試奏する。
手動試奏中は物理チャンネルを保護し、AYの共有ノイズ・エンベロープ設定やOPLLの共有User音色・リズムの競合を扱う。
適用済み状態は要求時だけ非同期で読み取り、UI描画周期から音声生成を呼ばない。Workerには命令と状態だけを渡す。

Stopは発音・未来の予約・試奏を止め、音色・clockとAYのtone／noiseの設定を保持する。
AYは実出力のvolumeを0にしても発音復元用の設定値を保持し、明示的に設定した音量0も保持する。
`setRetainedLevel`の情報を同じ順序・同じ時刻の命令として扱い、取消した未来の設定を残さない。
エンベロープShapeへの書込みは同値でも再発音し、通常のnoteOnでは共有エンベロープをリセットしない。

## 共通化と由来

YM2413はMaster Systemと共通のC++コアとJS endpointを使う。
OPLLの内部カウンターまで復元するpower-on snapshot、再発音時のkeyOff／keyOnの間隔、clock変換も共通化する。
AYはWeb／WASMと同じMAME由来の実装を使い、原典・ハッシュはTauriの`src-tauri/native-msx/`へ保存する。
AYのBSD-3-Clause（Couriersud）ライセンスもアプリへ同梱する。

## 検証

- JS全体：3,888件成功、1件skip。MSX固有の20件とMaster Systemの36件を含む。
- Rust全体：239件成功、4件ignored。MSX固有の13件を含む。
- 実配布WASMと実Workletの生成結果をNative C++の独立AY／OPLL出力と比較。44.1／48／96 kHzの93ケース、571,392出力フレームで最大差0。詳細は[native_msx_pcm_validation.json](native_msx_pcm_validation.json)。
- AYの全16 Envelope形状、tone／noise／mixer／I/O、clock、Stopとreset、音量0の保持、OPLLの再発音・共有リズムを検証した。チップcallback内の確保・解放は0。同じ全ケースをAddressSanitizerでも確認した。
- OPLL共通化後も、Master Systemの既存60 PCMケースは最大差0。
- Chromium／WebKitで初期コードのMain／Worker、AYの3声・OPLLの9 FM声と5ドラムのKeyboard、Guitarのマウス入力、各音源タブからの編集・PCキー試奏、独立ミキサー、Stop保持、mode切替が成功。Native IPCは模擬している。
- MSXの原典10ファイルと共通OPLL参照5ファイル、Master Systemの原典12ファイルと共有provider 9ファイルのハッシュを確認した。

既存NativeモードとWeb Audioの回帰確認もChromium／WebKitで成功した。
最終Tauri配布データでもMSXのMain／Worker・Keyboard・音源タブの操作を確認した。
833ファイルを取り込み、`import_release.py --check`で整合性を確認。最終データを含む`cargo build --offline --locked`も成功した。
取込みZIPのSHA256は`0fa9b9a1589399b153264975de0287bb98fd0fa10453cb0c2cc32dc689663c8d`。

変更はローカルへ反映済み。公開・コミット・pushは行っていない。

macOS ARM64で検証した。今回のWindows／Linuxの実ビルド、および実音声デバイスでの聴感確認は未実施。
