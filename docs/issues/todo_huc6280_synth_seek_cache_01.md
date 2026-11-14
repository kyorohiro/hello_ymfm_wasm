# HuC6280 Synth: exact seek checkpoint cache

開始: 2026-11-14。[Seek実装](todo_huc6280_synth_seek_01.md)に続く工程。

- [x] HuC6280の正式な状態保存／復元を追加する。全voiceのWave RAM・index・
      tick・Noise seed/counter・DDA・LFO・有効CH・resampler phase／出力履歴を含む。
      version／clock／rate／長さ／値を検証し、不正な入力では現状態を変えない。
      native所有objectやWASM heap全体のコピーは行わない。
- [x] JavaScript側でnative状態とselected CH・音量・mute設定を一貫して扱う。
      VGM parserのstream/bank位置・pending wait・小数時間・未消費PCM、および
      Live timelineの既知／不明Wave RAM・観測位置も正確に保存／復元する。
- [x] 対応するsource／clock／rate／出力設定に限る、容量・個数を制限した
      checkpoint cacheをSeekへ接続する。通常再生と再構築で途中状態を収集し、
      目的位置以前の近いcheckpointから再開する。保存／復元が使えない場合は
      従来どおり先頭から再構築し、途中状態を推測しない。
- [x] CH別On／Off・source／project変更とcacheの関係を定義する。Stop／Code Run／
      取消・失敗・連続Seekでもcache結果が古いrunを復活させないことを確認する。
      既存の再生／Pause保持、Capture、Auto update Off、Escape取消を維持する。
- [x] 実WASMでcacheあり／なしのPCMとsnapshotを比較する。Wave／LFO／Noise／
      DDA／stream・境界・不正状態・別instance／別source・異なるmuteを検証する。
      初回と繰り返しSeekの時間、cache容量、native core数を計測する。
- [x] 正式なSDK source bundleと生成物の整合性を保ち、配布ZIPでChromium／WebKitを
      無音検証する。既存7スイート・README／CI／検証記録・仕上げTODOを更新する。

公開・npm publish・tag・commit／push・Tauri反映は行わない。音声は物理出力しない。
SDK／native repositoryも、必要な変更・ローカルビルドに限定する。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_seek_cache_20261114.json)。Node 417/417、
native CTest 2/2、旧WASMとのPCM比較828ケースで差分0。
同じ独立ZIPをChromium／WebKitの全8スイート・16実行・170項目で無音検証した。
1240px／390pxの表示と、キャッシュ前後の実PCM一致を確認。

Cacheは位置バー横で初期On。約5秒おきと指定位置に収集し、最大64点／8MiBのpayload。
消去は再生欄の?内。Stop／Code Runは保持し、曲・project・CH別出力の変更で破棄する。
Node実WASMで2分先の初回約3.9–5.3秒、同じ位置への再移動約0.8–1.5ms。
ブラウザの混合fixtureでは92.34秒先が初回約11–12秒、再移動33–37msだった。
初めての未cache区間は引き続き再構築が必要で、計測値は速度保証ではない。

SDKはHuCの変更だけを含む`0.1.8-huc-state`未公開候補として固定し、正式な状態形式と
再ビルド用ソースを同梱。他DSPのJS／WASMは不変。PS1のreceiptだけはSDK参照を更新した。
root／native側ともcommit・stage・push・tag・公開なし。実聴・Tauri取り込みは未実施。
