# Game Gear Native対応

2026-10-22。Game Gear modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

Sega PSGのみを生成する。YM2612／YM2413は作らない。
3,579,545 Hz、3 tone＋noiseの4チャンネルと、Game Gearの左右独立のステレオマスクに対応する。
左右マスクは上位4bitが左、下位4bitが右で、`psg.setStereo(mask)`から設定する。

Master SystemとPSGの描画・状態管理を共有し、Master Systemは従来どおりモノラルとYM2413の構成を維持する。
既存の`psg`／`useSoundChip('segapsg')`、Main／Worker、Keyboard／音源タブ、チップミキサーから共通FX・liveFx・monitor・録音へ接続する。

## 状態と操作

Stopは音声と未来の予約・手動試奏を止め、period・noise設定・clock・最後の可聴音量・左右マスクを保持する。
resetは左右マスクを`0xff`へ戻す。試奏とscriptの所有権は各物理チャンネルで管理し、手動試奏中の左右ビットもscriptから保護する。
noiseのtone3連動では共有するtone3の周波数設定を考慮する。
状態は必要時だけ非同期で取得し、表示側から音声を進めたり周期的に命令を送ったりしない。
clock変更は指定frameへの適用確認後にJSの周波数計算へ反映する。試奏中に拒否されたclock変更だけでは音声エンジンを停止しない。

## 検証

音声デバイスを開かないオフラインPCM比較と、Native IPCを模擬した画面操作で検証する。

- 配布済みWASMと実際のWorklet描画処理による44.1／48／96 kHz・66ケース・436,224ステレオframeの比較で最大差0。全256通りの左右マスク、4音、8種のnoise設定、clock、Stop／reset、muteを含む。
- PSG共通化後のMaster Systemも60ケース・368,640ステレオframeで最大差0。
- Game Gearの66ケースはASan／UBSanでも成功。描画callbackのメモリー確保・解放はいずれも0。
- 原典7ファイルと共有ソース3ファイルの照合に成功。Master Systemの原典12ファイル・共有ソース9ファイルも一致。
- JS全体は3,975成功、既存skip 1件。Game Gearの29件は単体・実際のMain／Worker経路で確認し、Master System／MSX／OPLを含む対象144件も成功。
- Rust全体は265成功、既存ignore 4件。対象25件はGame Gear 11件とMaster System 14件で、所有権取消し・未来のclock適用・手動試奏の左右保護を含む。
- Chromium／WebKitのGame Gear画面検証で、Main／Worker初期コード、左右制御、tone／noise、4CH Keyboard、音源タブ・Guitar、clock・ミキサー、Stop／reset保持とmode切替を確認。Native IPCは模擬。
- 既存NativeモードとWeb Audioを含む画面検証、取り込み後の最終`dist`のGame Gear画面検証も両ブラウザーで成功。
- Tauriへ836ファイルを取り込み、整合性確認・macOSの`cargo build --offline --locked`・Python 8件／Node 31件が成功。
  アーカイブSHA-256：`662765f879bececf656280d094a4ae85ea425042a900feeb51a93ff0ebb91bff`。

PCM比較結果は[native_game_gear_pcm_validation.json](native_game_gear_pcm_validation.json)に保存する。
実機の音声デバイスでの聴感とWindows／Linuxでの実行確認は別途行う。
