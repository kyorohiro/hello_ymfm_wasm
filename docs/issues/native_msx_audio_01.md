# MSX Audio Native対応

2026-10-22。MSX Audio modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

- Y8950：3,579,545 Hz、FM 9CH、2オペレーター、5音のリズム。グローバル名は既存どおり`opl`。
- YM2413：3,579,545 Hz、既存MSXと共通のOPLL。グローバル名は`opll`。
- AY-3-8910：1,789,773 Hz、3 tone・共有noise／envelope。グローバル名は`ay`。

この3音源だけを生成し、Genesisや別のOPLを作らない。各音源はモノラル出力を使い、独立したミキサーから共通FX・liveFx・monitor・録音へ接続する。
既存の初期コード、Main／Worker、`useSoundChip()`によるprimaryの借用、Keyboard／音源タブを使う。
Y8950は現行PlaygroundのFM／リズムAPIに合わせる。低レベルY8950のADPCMメモリーAPIは今回の接続対象外。

## 状態と操作

MSXのYM2413＋AYと、OPLの状態・描画・所有権管理を共有する。Y8950はMSX Audioでのみ選択し、DOS PCの3 profileは維持する。
3チップを含む命令群は、すべて検証してからキューへ入れる。Y8950側で拒否した命令によって、MSX側に未送信の保持情報を残さない。

Stopは3音源の発音・予約・手動試奏を止め、音色・clock・共有設定・AYの明示音量0とenvelope設定を保持する。
Keyboardは音源とチャンネルを選んで試奏する。Y8950の通常keyOffはリリースを残し、試奏の解放では元のTLを保持して即時ミュートする。
音源ごとの適用済み状態は既存の独立したstatus IPCで取得する。clockの適用確認IDはチップ群ごとのcontextで管理し、衝突させない。
Stop後の状態は`native_genesis_msx_audio_status`でまとめて取得する。読み取りで音声を進めたり、表示のための音声更新を行ったりしない。

## 検証

音声デバイスを開かないオフラインPCM比較と、Native IPCを模擬した画面操作で検証する。

- 配布WASMと実際のWorklet描画処理によるY8950の44.1／48／96 kHz・138ケース・847,872ステレオframeで差0。PCM、status、IRQ、4つのraw portを比較し、9CH、アルゴリズム・feedback・リズム・clock・Stop／reset・再発音・mute・timer・空のADPCMメモリーでのraw操作を含む。
- 同じ138ケースをASan／UBSanでも確認し、描画callbackのメモリー確保・解放はいずれも0。
- 既存のDOS PC用OPL 198ケースも最大差0。原典7ファイルと共有ソース6ファイルの照合も成功。
- 同じ設定の2コアで、毎frame 28回portを読む側と読まない側の8,192 frameを比較し、PCM・状態が完全一致。Status取得が発音を変えないことを確認。
- JS全体は3,996成功、既存skip 1件。MSX Audio／OPL／MSX／Master System／Game Gearを含む対象164件も成功。
- Rust全体は274成功、既存ignore 4件。MSX Audio対象9件は、実PCMが3音源の独立出力の和に一致すること、独立mix・共通FX／録音・時刻・取消し・Stop保持・複合受付失敗を含む。
- Chromium／WebKitで3音源のMain／Worker初期コード、tone・noise・リズム・envelope、独立したclock／ミキサー、Keyboard／音源タブ、Stop保持とmode切替を確認。Native IPCは模擬。
- 既存NativeモードとWeb Audioを含む画面検証、取り込み後の最終`dist`のMSX Audio画面検証も両ブラウザーで成功。
- Tauriへ837ファイルを取り込み、整合性確認・macOSの`cargo build --offline --locked`・Python 8件／Node 31件が成功。
  アーカイブSHA-256：`2026cb6c4dd5fe6bf6e7725ed4482330c636944cdc58fc8adb86fa2e0dba4ab8`。

比較結果は[native_msx_audio_pcm_validation.json](native_msx_audio_pcm_validation.json)に保存する。
実機の音声デバイスでの聴感とWindows／Linuxでの実行確認は別途行う。
