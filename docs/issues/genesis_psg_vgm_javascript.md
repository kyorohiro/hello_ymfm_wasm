# Genesis VGM → JavaScript: PSG対応

PlaygroundのSchedule / Write / HighにYM2612＋PSGの変換を追加。
Include PSGは既定ON。OFFでは従来のFM／DACのみの変換になる。
YM2203／YM2608／YM2610のFM専用変換には適用しない。PSG単独ファイルのImportは今回の対象外。

- Write / High：元のバイト列を `psg.write(value)` で出力。HighもPSGはraw。
- Schedule：既存 `scheduleWritesSamples` に `[offset, "psg", value]` を追加。
  FM/DACと同じ44,100 Hzのサンプル時刻・予約起点を使用する。
- combined出力はFM／PSGの同時刻の並び順も保持。
  CH分割時はPSGを1トラックにまとめ、共有ラッチの順序を保持する。
- PSGのDACストリームも既存パーサーのconsumeWaitで展開する。
  YM2612 DACのInclude DAC、外部データファイルは従来どおり。
- Main / Workerの両経路でPSG予約をAudioWorkletへ渡す。ymfm / Nuked双方の受信処理を使用。
- PlaygroundのPSGは3,579,545 Hz固定。異なるクロックでは音程・ノイズ速度が変わり得ることを
  画面と生成コードに明示。Genesis向けのPSGが対象で、他機種のPSG派生チップの完全再現は保証しない。
- デュアルPSGは未対応。Include PSGをOFFにしてFM/DACのみ取り込める。

検証：3モード×CH分割ON/OFFでFM／PSGイベント時刻、ラッチ順、終了待ち、Include PSG OFFを確認。
PSGストリームとYM2612 DACの共存、Main／Workerの共通予約起点、48 kHz Workletでの
サンプル時刻→出力フレーム変換を確認。関連109テスト成功。
itch.io向けパッケージの作成・依存検証も成功。公開・ブラウザー試聴は未実施。
既存のYM2612 DAC stream exportテスト1件の失敗は別件として継続。
