# HuC6280 Synth: VGM Seek and reconstruction timing

開始: 2026-11-14。[仕上げTODO](todo_huc6280_synth_finish_01.md)のSeek工程。

- [x] VGMコンテナに位置バーを追加。ドラッグ中は候補位置だけ表示し、
      離した時にSeekする。矢印／Home／End、Escapeで取消に対応する。
- [x] 再生中からの移動は再生を続け、PauseからはPauseを保持する。
      Stop／終了後からは移動先をPauseで準備する。末尾と範囲外も正しく扱う。
- [x] 別のHuC6280／VgmPlayer／timelineを音声未接続のまま目的位置まで進め、
      成功後だけ置き換える。LFO／Noise／DDA／streamの内部進行とPCMを復元し、
      Auto update Offでも目的位置の6CH snapshotを一度反映する。
- [x] CH別On／Offは最新値を保つ。表示対象CHと編集中の音色は変更しない。
      Pause試奏／Capture、Code Run、Stop、曲・project切替、連続Seekや破棄で
      古い非同期処理が再生・音色・位置を復活させないようにする。
- [x] 再構築は短い処理単位でUIへ制御を返し、進捗／Cancelを用意する。
      取消・失敗では元の再生状態・位置・未消費PCMを保持する。
      生のWASMメモリーコピー等で安全性の不明なcacheは作らない。
- [x] 実WASMで目的位置以降のPCMと直線再生を比較し、boundary・短い戻り・
      mute・Auto Off・非同期競合を確認する。再構築時間を測りcache方針を記録する。
- [x] 独立ZIPのChromium／WebKitを物理音声なしで検証し、既存6スイートを回帰確認。
      README／CI／検証記録・仕上げTODOを更新する。

VGM再生中の直接編集・新しいnative snapshot API・公開・Tauri反映は今回含めない。
キャッシュは正確性と実測を確認して判断する。ユーザー保存データ・commit／pushには触らない。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_seek_20261114.json)。Node 389/389、
独立ZIPの全7スイートをChromium／WebKitで無音検証し154/154項目成功。
1240px／390pxの表示、Safariの未フォーカスrangeと同期blur/change、リソース解放も確認。
WASM／SDK／音量補正は変更なし。実聴・実ゲーム比較・長時間デバイス動作は未実行。

確認手順: VGMを読み込む → 位置バーをドラッグして離す。再生中は再生を継続し、
Pause中はPauseを保つ。Stopからは目的位置をPauseで準備する。
Escape／Cancel seekで取消。Auto update Offでも目的位置の設定を一度表示する。

## 計測と残作業

`node docs/synth-huc6280/song_seek_benchmark.mjs`で再測定できる。
このMacのNode／実WASM・自作fixture計測は5秒先175–259ms、30秒先1051–1517ms、
2分先4340–5930ms。初期化済みWASM、timer yield、元のPause runを保持した条件。
reference coreは最大2個、各native heapは16,908,288bytes。ブラウザ／実ゲームの保証値ではない。

現在は先頭から再構築する方式。長い移動にはcache改善の余地があり、仕上げTODOへ残した。
正確なnative／parser／resampler／stream状態を扱える方式から検討し、heapコピーや
レジスタだけの近似復元は採用しない。公開・Tauri反映も未実行。
