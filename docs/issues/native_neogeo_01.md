# Neo Geo（YM2610／YM2610B）のNative対応

2026-10-22。PC98のNative OPN経路を基に、既存のNeo Geo／Neo Geo（YM2610B）modeをTauriのNativeエンジンへ接続する。Web Audioを既定にする方針は維持する。

## 対応範囲

- Browser/WASMと同じymfmコアをC++で直接生成する。YM2610はFM 4CH、YM2610Bは6CH。両方ともSSG 3CH、ADPCM-A 6声、ADPCM-B 1声を持つ。
- YM2610の公開FM 0..3は物理CH 1／2／4／5へ変換する。Main・Worker・Keyboard・Operatorsで同じ対応を維持する。
- ADPCM-AとBにそれぞれ16 MiBを生成時に確保する。転送は64 KiB単位で、再生callback内では領域の拡張や転送データの解放を行わない。
- `fm`／`ssg`／`adpcmA`／`adpcmB`（`adpcm`はBの別名）、`play()`、時刻付きWorker命令を接続する。Nativeの`useSoundChip('ym2610')`は選択中のOPNB音源を借り、6CH版では`useSoundChip('ym2610b')`も同じ音源を返す。
- Aは固定レートの6声、BはDelta-Nによるピッチ変更・全範囲repeatを使う。A/Bの符号化形式とメモリーを分け、AへB用のデータを変換して渡さない。
- 既存Sample Editor／Neo Geoサンプラーのファイル・マイク・編集済みPCMを、共有ADPCM-BエンコーダーからNativeへ渡す。音声デコードは読込み時のWebView側で行い、再生PCMはNative側に置く。
- KeyboardのChip／CH選択、OperatorsのFM編集・試奏、SSG・A/Bの試奏に対応する。手動押下、古いキー解放、演奏ownerの取消しを物理voice単位で区別する。
- 共通ミキサー・FX／liveFx・Audio monitor・最終出力録音へ接続する。
- Stopは発音・予約を止め、音色・clock・A/B ROM・サンプル範囲を保持する。SSGの音量とエンベロープ選択も次のkeyOnへ引き継ぐ。resetもROMを保持する。
- 標準clockはWebと同じ8 MHzで、`await fm.setClock(hz)`で変更できる。状態は適用済みレジスターを非同期取得し、先読み中のJS状態を上書きしない。

独立した追加チップとWeb専用timeline APIは既存のWeb Audio経路を使う。C++コアのread／PCM生成は同期のまま、UIからの状態取得だけを非同期にする。

## ソースと検証

Tauriの`src-tauri/native-ym2610b/`に原典・ハッシュ・ライセンスを保存し、共通ymfmは`native-genesis`を共有する。GNUリンカーでは新しいラッパーを共有ymfmより前に配置する。

- Native／WASMのPCMを両variant、44.1／48／96 kHzで比較する。FM・CH3特殊・SSG noise/envelope・A全声・B pitch/repeat・独立ROM・末尾アドレス・終了フラグ・mute・clock・Stop/resetを含む。
- Rustで転送境界・保持データ・予約／取消し・manual lease・共有レジスター保護・共通ミックス／FX／録音を確認する。
- JSで標準Synthとのレジスター列一致、実MessagePort経由のWorker、A/B転送の所有者と即時準備、非同期処理中のStopを確認する。
- Chromium／WebKitで両modeの初期コード、Main／Worker、サンプラー、Keyboard／Operators、Stop保持、mode切替を確認する。Native IPCは模擬し、実音声デバイスは開かない。

## 2026-10-22の検証結果

- JavaScript全体: 3,277件成功、失敗・skipなし。新しいendpoint・Main／Worker接続のほか、実MessagePortを使い、転送中のowner取消し／performance終了で残りのチャンクを送らず要求を解決する8件を含む。この取消し修正はPC98にも適用した。
- Rust全体: 196件成功、失敗なし、既存の実デバイス等の4件はignored。新しい13件で両variant・ROM境界・転送上限・manual lease・共有制御・予約／取消し・実PCM・共通FX／録音を確認した。
- macOS ARM64で、Nativeと配布済みWASMの72ケース・442,368ステレオフレームを比較し、最大差は0。両variantと44.1／48／96 kHzを含む。C++ fixtureの音声callback内の確保・解放も0だった。詳細は[native_neogeo_pcm_validation.json](native_neogeo_pcm_validation.json)。
- Linux x86_64（Debian、GCC 12.2.0-14+deb12u1、GNU ld 2.40、C++14）でもC++をコンパイルし、共有ymfm→ラッパーの誤った順序でリンクエラーを再現、build.rsと同じラッパー→共有ymfmの順序で成功した。両variantのEOS・Stop/reset・独立ROM・callback確保／解放0のself-testも成功。Linuxでの追加72ケースPCM比較は実行許可待ちで中断したため未実施で、Linux用PCM比較JSONは作成していない。
- Chromium／WebKitで既存Native経路の回帰確認が成功。最終Tauri配布データでもNeo Geo両modeの初期コード、Main／Worker、独立A/B転送、サンプラー、全Keyboard voice、Guitarのマウス入力、OperatorsのPCキー試奏、Stop保持、mode切替が成功した。Native IPCは模擬している。
- 原典3ファイルと共有ymfm 11ファイルのハッシュ、Tauriへ取り込んだ828ファイルの整合性を確認。最終配布データを含む`cargo build --offline --locked`も成功した。

取込みZIPのSHA256は`56cc5b0109328d20f9224f63e5caa1bf2f9cae1e29401625805786019e35816e`。
実音声デバイスを開く試験・聴感確認と、今回の追加分のWindows／MSVC・LinuxのTauri全体ビルドは未実施。
変更はローカルへ反映済みで、公開・コミット・pushは行っていない。

Linux検証用の一時コンテナー`tetorica-neogeo-arm-audit-20261022`は、明示削除の許可操作も中断したため削除確認は未実施。`--rm`と`sleep 3600`で起動しており、起動60分後に終了・自動削除する設定。名前にarmを含むが、実際の検証環境は上記のx86_64である。
