# PSF無音バッチ診断CLI（2026-11-12）

- [x] 既存PSF1／MiniPSF loader・CPU/HLE＋MAME SPU coreと入力制限を確認する。前タスクの未commit README／examples変更は保持する。
- [x] 指定フォルダーの曲を決定的な順で列挙し、entry選択・短時間render・entry単位の失敗分離を備えたCLIを追加する。壊れた無関係なファイルで他曲の診断を止めない。
- [x] 曲ごとに別Nodeプロセスを使い、初期化・同期WASM実行を含む実時間timeoutと中断・回収を実装する。ファイル数・サイズ・探索・出力・batch全体も上限を設ける。
- [x] 読込／依存不足／未対応処理／時間切れを分類し、有限PCM統計、native frame進行、24CH活動、SPU RAMのhash／変化量をJSONへ記録する。無音だけをエラーと決めない。PCM・RAM本体やゲームのサンプルbytesは保存しない。
- [x] 自作の実行可能PSF／MiniPSF・無音・壊れたCRC・不足library・未対応処理・停止しないworkerで検証する。フォルダー内の失敗が混在しても残りを継続し、出力先の入力上書きを避ける。
- [x] 使い方・終了コード・診断と音の忠実度の区別・再開用記録を残し、利用可能なローカル入力があれば短い実データ診断も行う。外部ゲームデータは同梱・取得しない。

境界: 音声デバイス・通常browser／native app・OS音量を使わない。既存browser UI／PSF core／WASM／SDK／ゲインは変更・再ビルドしない。VABの静的抽出や実聴・全ゲーム互換性の確認とは別の診断ツールとし、commit／push／公開はしない。

完了: [使い方](../../scripts/check_psf_batch.md)・[検証記録](psf_batch_diagnostics_verification_01.json)。自動テスト22件成功。既存ローカルArc the Ladの40曲を各先頭2秒、合計80秒分のnative音声clockで無音診断し、全曲render完了・有限PCM・native frame進行一致を確認。実聴／曲全体の確認とは別。元データを同梱せず、WASM／UIを変更・再ビルドせず、commit／push／公開は未実施。
