# DOS PC OPL Native対応

2026-10-22。既存DOS PCのYM3526／YM3812／YMF262 modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

- YM3526 OPL：3,579,545 Hz、9 FMチャンネル、正弦波、モノラル。
- YM3812 OPL2：3,579,545 Hz、9 FMチャンネル、4波形、モノラル。
- YMF262 OPL3：14,318,180 Hz、18 FMチャンネル、8波形、6組の4オペレーター音色、左右出力。
- 既存`opl`／`OPL_PRESETS`と、選択中の`useSoundChip()`をMain／Workerから使う。選択したOPLだけを作成し、余分なYM2612・PSG・AY・OPLLは作らない。
- チップ別ミキサーから共通FX／liveFx・monitor・録音へ接続する。

## 状態と操作

既存Keyboardでチャンネルを選び、音源タブでもオペレーター・アルゴリズム・LFO・リズム・OPL3の4op構成と左右出力を編集して試奏する。
4opの従属チャンネルとリズム予約チャンネルはKeyboardの選択肢から除外する。
通常の発音のたびに選択肢を作り直さず、構成変更時だけ更新後の状態を通知する。
手動試奏では4opの両チャンネルを保護する。音源タブの設定変更は明示的なユーザー操作として扱う。

リズムは共有する物理チャンネル6〜8で5音を生成する。コードの`setRhythm()`と音源タブのトリガーを使う。
Mainのloop所有権にもリズム音を登録し、loop取消しでは所有する音だけを解放する。古いloopの終了で、後から同じ音を引き継いだloopを止めない。

通常の`keyOff()`はリリースを残し、試奏の解放・Stopは即時に音を止める。即時ミュート時も設定済みのTLを保持し、再発音で復元する。
Stopは未来の予約と試奏を取消し、音色・clock・LFO・出力・4opとRhythm構成を保持する。
適用済み状態とStatus／IRQは要求時に非同期で取得し、読み取りでは音声を進めない。Workerには命令と状態だけを渡す。
clock変更は予定frameへの適用を確認してからJS側の周波数計算へ反映する。手動試奏中はclock変更だけを拒否し、音色設定や他チャンネルの演奏を継続する。
構成変更で解放する所有権は、変更した4opの組に限定する。

## 由来と検証

Web／WASMと同じymfmを使い、既存のOPL／PCM providerは一度だけリンクする。
原典・ハッシュはTauriの`src-tauri/native-opl/`へ保存し、GNUリンカー向けの依存順とMSVC用の例外処理設定を維持する。

音声デバイスを開かないオフラインPCM比較と、Native IPCを模擬したChromium／WebKitで確認する。

- 既存の配布WASMを実際のWorklet描画処理で動かし、44.1／48／96 kHz・198ケース・1,216,512ステレオframeを比較。最大差は0。全チャンネル、波形、6組の4opと全アルゴリズム、左右出力、リズム、clock、Stop、再発音、Status／IRQを含む。[PCM比較結果](native_opl_pcm_validation.json)。
- 同じ198ケースをASan／UBSanでも確認。描画callbackでのメモリー確保・解放はいずれも0。
- 原典11ファイルと共有実装4ファイルのハッシュ照合を確認。
- JS全体：3,947成功、既存skip 1件。OPL単体と実際のMain／Worker経路59件を含む。
- Rust全体：254成功、既存ignore 4件。OPL対象15件は4op共有所有権、互換モード、無関係なCHのPCM保持、clock拒否と適用barrierを含む。
- Chromium／WebKitのOPL画面検証：3チップの初期コード、Main／Worker、banked register、2op／4op／リズム、PCキー・Guitar・音源タブ、clock・ミキサー、Stop保持とmode切替を確認。Native IPCは模擬。
- 既存NativeモードとWeb Audioを含む画面検証も両ブラウザーで成功。DX7のWorker検証は、音源とは独立したFXポートの適用を明示的に待つよう修正。
- Tauriへの取り込み834ファイル、整合性確認とmacOSの`cargo build --offline --locked`が成功。
  アーカイブSHA-256：`21443ed6e93542ccb469a78aa4a24c7d540ff7a376e26bf428dd7272f9bdc397`。
- Tauri側のPython 8件／Node 31件と、最終`dist`のOPL画面検証（Chromium／WebKit）も成功。

実機の音声デバイスでの聴感とWindows／Linuxでの実行確認は別途行う。
