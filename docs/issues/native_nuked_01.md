# 32X Nuked Native対応

2026-10-23実装・検証完了。32X NukedのYM2612を、Browser版と同じNuked OPN2コアでNative生成する。
Web Audioを既定のままとし、通常のGenesis／32Xは既存のymfmを使う。

## 構成

`genesis-full-nuked`はNuked YM2612＋Sega PSG＋RF5C164＋32X PWM。
旧URLの`genesis-nuked`も同じNukedコア＋PSGへ接続する。
既存の時刻付き命令・Main／Worker・Keyboard・音源タブ・ミキサー・DAC・FX・liveFx・monitor・録音を共有する。
Native再生中にAudioWorkletやPCM転送用WebSocketは生成しない。

Browser版のNuked WASMは、レジスターのaddress／dataの各write後に24内部clockを進める。
この挙動も含めて一致させ、ymfmとは別の生成関数を選択する。通常版の音の計算は変更しない。
NativeのFM／PSG clockは既存Genesisと同じ7,670,454／3,579,545 Hz固定で、動的なclock変更は追加しない。
Nukedの自然なreset直後のDCも配布Workletと一致させる。明示的なStopでは設定を保持して出力を止め、
次のFM／CSM・DAC・PSG発音で再開する。無効なFM CH番号のkey-onやCH3特殊モードだけでは再開しない。
FM／PSG／masterの音量rampはNuked側で独立させ、一方の変更で他方の進行をやり直さない。
Nukedの内部operator envelope値は既存Browser版と同じ未対応であり、音色パラメーター編集と試奏は従来のFM APIを使う。

起動・再接続時にNative側のmodeとengineを確認する。Nukedを選んだのに別コアを返す旧ホストを拒否し、
自動的なWeb Audio／ymfmへの切替はしない。標準21 Modeと旧Genesis Nuked URLをNativeで選択できる。
CSMは通常のreg28 key gateと別に所有者を記録し、loop取消しでTimer-A／CSMを止めても、別の手動CH3発音を巻き込まない。

## ライセンスと配布

Nuked OPN2はLGPL-2.1-or-later。独立したTetoricaのコードは従来のライセンスを維持する。
Nukedのライセンス・著作権・由来・対応ソースと変更内容を同梱する。
静的リンクするため、配布物には対応するアプリケーションのソース・lockfile・ビルドスクリプト・必要なfrontendをまとめ、
利用者がNukedを変更して再ビルド／再リンクできるようにする。
同じ仕組みを既存のLGPL SNESコアにも適用する。
この作業でnpmパッケージのライセンス変更や公開は行わない。
Web／itch配布にもNukedの対応ソースとWASMビルド手順を追加した。npm配布には既に同じ材料が含まれており、
BSDの自作コードとLGPLの第三者コンポーネントという区分を維持する。

## 検証

- 実際の配布Nuked WASM／Workletとの比較：44.1／48／96 kHz、222ケース、1,363,968ステレオframe。FM全6CH×8 algorithm、pan／LFO／operator設定、DAC、timer、CH3特殊／CSM、PSG、reset／Stop・再発音を含み、PCM最大差`2.9802322387695312e-8`。status／IRQ／4つのread portは完全一致。
- ASan／UBSanでも同じ222ケースが成功。callback中のCのmalloc／freeとC++のnew／deleteはいずれも0。代替ymfm APIのfail-fast stubにより、Nuked選択時に隠れたymfm呼出しがないことも確認。
- 通常ymfmの既存6ケースも再比較し、最大差`3.725290298461914e-9`。Nuked固有の変更が既存の音の計算へ入っていないことを確認。
- JS対象39件、全体4,051成功・既存skip 1件。Main／実Worker port、FM／PSG／RF／PWM、Keyboard・音源タブ、Stop保持、世代取消し、失敗・旧ホストの拒否を含む。
- Rust対象13件、全体304成功・既存ignore 4件。実Nukedコアの選択、4音源の独立合成との一致、DAC、時刻・callback分割、未来命令取消し、cold CSM取消し、手動CH3保持、共通FX・master・録音を検証。MCPの既存localhostテストのみsandbox外で実行し、音声デバイスは開かない。
- Chromium／WebKitの対象検証と、全Native mode・Web Audioを含む画面回帰が成功。Main／Workerの実際の初期コード、Keyboard・音源タブ、Stop／Run、mode／engine切替を確認。Native IPCは模擬し、Native経路でlive AudioContext／AudioWorkletが生成されないことも確認。
- Tauriの既存Python 11件／Node 31件、Nuked原典9ファイルのhash照合が成功。
- Tauriへ845ファイルを取り込み、整合性を確認。アーカイブSHA-256：`af95db5171db7e3d0d9c76799735d9742b421a46662ccda5afe8a7554180dc0f`。
- ソースZIPの1,289ファイルを抽出して全hashを照合。Git履歴・資格情報・インストール済み依存・Nativeのビルド生成物・ZIP自身を含めないこと、同じ入力で同じZIPになることを検証。
- 展開したソースのNuked Cファイルにコメントを加えた状態で、別フォルダーから`cargo build --offline --locked`が成功。npm／Cargoはキャッシュ済み依存を使い、単体Nodeと対応ライセンスを指定して準備した。元のcheckoutを音源ソースとして参照せず、アプリを再ビルドできることを確認。
- 取り込み後の最終`dist`でもChromium／WebKitのNuked対象検証が成功。元のTauriプロジェクトのmacOS `cargo build --offline --locked`も成功。

PCMの結果は[native_nuked_pcm_validation.json](native_nuked_pcm_validation.json)に保存した。
ソースZIPのSHA-256は`3be27e526057ec48ae4ddc48677c14221d52e7cd4edee2eb35dc57ed74578f55`。
検証後に、ソースZIPと現在のアプリケーション1,289ファイルのhashが引き続き一致することも確認した。

実機での試聴・長時間安定性とWindows／Linuxでの実行確認は別途行う。
