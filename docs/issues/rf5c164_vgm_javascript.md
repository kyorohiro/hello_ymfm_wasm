# RF5C164 VGM → JavaScript

Playground の Import VGM / S98 で、RF5C164 のレジスター操作と波形 RAM 転送を JavaScript に変換する。

- RF5C164 単独、または YM2612 + DAC + PSG との混在に対応。
- 12.5 MHz の単一 RF5C164 が対象。Write モードのみ、末尾まで一回再生する。
- Include RF5C164 は検出時に ON。混在ファイルでは OFF にすると従来の OPN 変換を使用できる。
- Include DAC / Include PSG は混在変換にも適用。混在再生には YM2612 Playground を選ぶ。
- RAM データは仮想 .dat ファイルとして保存し、再生開始前に読み込む。チップへの転送自体は元のイベント位置で行う。
- レジスター 7 のバンク選択、0xC2 メモリー書き込み、0xC1 RAM ブロック、0x02 データバンクからの 0x68 転送に対応。
- 非同期 writeRegister / loadMemory と sleepSamples による再生。操作順序と待ち時間は保持するが、実時間でのサンプル精度は保証しない。
- Schedule、High、ループ再生は今後の対応。RF5C164 有効時はチャンネル分割と DAC ファイル化のオプションを無効にする（DAC は raw write 出力）。

検証：生成 JavaScript のイベント列とバンクアドレス、FM/DAC/PSG の選択、失敗時の dispose、モード切り替えをテスト。途中の RAM 更新を含む入力について、生成コードと元 VGM を同じ WASM コアで実行し、PCM の一致と発音を確認した。この検証はオフライン実行であり、ブラウザーの非同期通信遅延を含まない。

## スロー再生の修正

初版は各 RF 操作の RPC 応答を await した後、トップレベルの sleepSamples で相対待機していた。このため通信遅延とタイマーの超過時間が演奏時間に累積した。

生成コードは操作を同一 MessagePort に順番に送信し、応答待ちは最後にまとめる。Promise の失敗は捕捉し、待機時または終了時に通知して dispose する。待機は performance.now() を基準に元 VGM の絶対サンプル位置までの残り時間だけ行う。遅れたイベントは順序を保持して追いつくが、Worklet のサンプル単位予約ではないため短時間の揺らぎは残る。

遅延 ACK、密な DAC/RF イベントとタイマー超過、非同期 RPC エラーの回帰テストを追加。関連24テスト成功。既存の生成 JS には反映されないため、VGM の再 Import が必要。ブラウザーでの実曲試聴は未確認。
