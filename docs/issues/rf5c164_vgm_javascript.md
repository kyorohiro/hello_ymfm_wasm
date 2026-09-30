# RF5C164 VGM → JavaScript

Playground の Import VGM / S98 で、RF5C164 のレジスター操作と波形 RAM 転送を JavaScript に変換する。

- RF5C164 単独、または YM2612 + DAC + PSG との混在に対応。
- 12.5 MHz の単一 RF5C164 が対象。Write / High モードで、liveLoop により全体を繰り返し再生する。VGM 内部のループ開始位置には未対応。
- Include RF5C164 は検出時に ON。混在ファイルでは OFF にすると従来の OPN 変換を使用できる。
- Include DAC / Include PSG は混在変換にも適用。混在再生には YM2612 Playground を選ぶ。
- RAM データは仮想 .dat ファイルとして保存し、再生開始前に読み込む。チップへの転送自体は元のイベント位置で行う。
- レジスター 7 のバンク選択、0xC2 メモリー書き込み、0xC1 RAM ブロック、0x02 データバンクからの 0x68 転送に対応。
- 非同期 writeRegister / loadMemory と sleepSamples による再生。操作順序と待ち時間は保持するが、実時間でのサンプル精度は保証しない。
- Schedule は FM/DAC/PSG に適用し、RF5C164 部分は Write の liveLoop を使用する。RF5C164 自体のサンプル単位予約は未対応。FM のチャンネル分割、DAC ファイル化、High / Note-ish、PSG High は既存の変換処理を使用する。RF5C164 は共有 RAM と選択レジスターの順序保持のため、全8CHを1つの専用 liveLoop にまとめる。

検証：生成 JavaScript のイベント列とバンクアドレス、FM/DAC/PSG の選択、失敗時の dispose、モード切り替えをテスト。途中の RAM 更新を含む入力について、生成コードと元 VGM を同じ WASM コアで実行し、PCM の一致と発音を確認した。この検証はオフライン実行であり、ブラウザーの非同期通信遅延を含まない。

## スロー再生の修正

初版は各 RF 操作の RPC 応答を await した後、トップレベルの sleepSamples で相対待機していた。このため通信遅延とタイマーの超過時間が演奏時間に累積した。

生成コードは操作を同一 MessagePort に順番に送信し、応答待ちは最後にまとめる。Promise の失敗は捕捉し、待機時または終了時に通知して dispose する。待機は performance.now() を基準に元 VGM の絶対サンプル位置までの残り時間だけ行う。遅れたイベントは順序を保持して追いつくが、Worklet のサンプル単位予約ではないため短時間の揺らぎは残る。

遅延 ACK、密な DAC/RF イベントとタイマー超過、非同期 RPC エラーの回帰テストを追加。関連24テスト成功。既存の生成 JS には反映されないため、VGM の再 Import が必要。ブラウザーでの実曲試聴は未確認。


## High 変換

High では、既存の RF5C164Synth が生成する書き込み列と一致する、隣接した同時刻の操作を高級 API に変換する。Write は引き続き利用可能。Include RF5C164 が ON のときも High を選択でき、Schedule も選択可能（RF5C164 部分は Write）。

- チャンネル選択＋音量／パン／開始位置 → setChannel
- チャンネル選択＋連続した速度の下位・上位バイト → setPitch（値は生の step）
- チャンネル選択＋ループ先の下位・上位バイト → setChannel の loopStart
- チャンネル選択＋対象チャンネル OFF→ON → keyOn
- マスクの単一チャンネル OFF への変化 → keyOff

余分な選択書き込み・有効化・再トリガーを追加しない。選択のない単独パラメーター書き込み、時間差のあるバイト対、複数チャンネル同時マスク変更などは raw fallback。RAM 転送は loadMemory を維持。混在する FM・DAC・PSG は既存の OPN 変換経路で出力し、High・Note-ish・DAC データファイル設定を維持する。

送信の並列化と絶対時刻による遅れ補正は Write と共通。High と Write の正確な時刻付きレジスター列の一致、および High と元 VGM のオフライン PCM 一致をテストした。ブラウザーの実曲試聴は未確認。


## liveLoop / CH 分割の機能退行修正

初期の RF 専用変換で消えていた liveLoop と FM CH 分割を復元した。既存の FM/DAC/PSG 出力をそのまま使い、RF5C164 の専用 liveLoop を追加する。RAM ファイルとチップの準備後にループを登録し、ループ終了ごとには dispose しない。liveCleanup で解放する。

RF の各周回の先頭でレジスターを reset（波形 RAM は保持）。書き込みごとの RPC 応答は待たず、sleepSamples は liveLoop 内の共通絶対サンプルクロックを使用する。トップレベルの相対待機へは戻していない。周回末尾で送信済み操作の結果を確認する。長さ0の入力でも最低1サンプル待機する。

Write/High × CH 分割 ON/OFF、既存 FM 出力との一致、2周の RF 操作・待ち時間、停止時の解放、非同期失敗を検証。関連27テスト成功。変更は再 Import が必要で、ブラウザー実曲試聴は未実施。


## Mega CD の変換オプション

Schedule の選択禁止を解除。既存の FM/DAC/PSG 変換に scheduled:true を渡し、RF5C164 は Write liveLoop とする。UI と生成コードにこの範囲を明記する。CH 分割・DAC データファイルも常に選択可能。

HTML のエントリーモジュール、Import モジュール、RF 変換モジュールの URL に同じ更新識別子を付け、古いコードとの混在を避ける。localhost:8897 から配信される HTML/JS の更新を確認。Browser 接続は利用できず、実画面の自動確認は未実施。
