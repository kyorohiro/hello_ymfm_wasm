# SID Player: 6581／8580選択（2026-11-08）

通常の[`docs/sid-player/`](../sid-player/index.html)に**Auto／6581／8580 Preview**を追加した。Autoは元fileの宣言に従い、既知8580は専用modelで再生する。Synth／Playground／SDKは引き続き6581で、今回の変更対象はPlayer。

## 操作と状態保持

- `SID model`はsubtuneの隣に表示する。Autoで未指定／eitherを開く場合は、既定Onの補完設定でPAL／6581を選ぶ。手動modelは未指定／eitherを解決し、既知の宣言と違うmodelは理由付きで拒否する。元headerを変更しない。
- model変更は最後に読み込もうとしたfileを再検証する。候補が成功した時だけ新しい選択へ移り、Play前に自動発音しない。失敗は旧再生を保持し、取消・成功したsubtune変更・Stop後のselect表示はaccepted設定へ戻る。
- file情報に元headerと選択targetを分けて表示し、badge／engine情報には稼働modelを表示する。8580で未提供のvoice Envelopeは「—」とし、0で偽装しない。
- 8580はPAL・single SID v2・C64 machineのVBI／CIA／RSIDを扱う。Direct VBIは6581のみ。NTSC／multi-SIDは今回追加していない。ROMは従来どおりcaller提供のsnapshotだけで、同梱・自動取得・保存はしない。

## 実装

`model_policy.js`が元宣言と選択を検証し、`models.js`が既存6581 validatorか8580 validatorとcoreを選ぶ。既存のshared parser／CLIの6581制約は維持する。

`core8580.js`は研究用`Sid8580MachineCore`を通常Playerのstate形状へ適合し、専用endpoint／C64の二つのWASMを直接結ぶ。研究用resonance／cutoff補正は両方Off。6581は既存の二つのWASMを使う。既存core・DSP・WASM・gainの再調整はしていない。

AudioWorkletのStopにはepochを追加し、初期化待ちの古いStartが後から発音しないようにした。不正なStop引数では再生を変更しない。モデル変更・subtune・ROM設定・非同期readの所有権は既存の候補検証方式へ接続した。

## 検証

- `npm run test:sid-player`: **110件成功**。8580の実WASM VBI／CIA／RSIDを44.1／48／96kHzで確認し、Lab coreとのPCM一致、旧6581の不変、失敗時の旧状態／次PCM保持、synthetic BASIC ROM、起動中Stopを含む。
- [ソース版](sid_player_models_browser_01.json)と[実ZIP版](sid_player_models_zip_browser_01.json): Chromium／WebKit各35項目、**計140項目成功**。Auto・unknownの手動model・元宣言保持・model不一致・Envelope不明表示・POT失敗時の旧音保持・二つのWASM取得中Stop・狭い画面を含む。選択失敗後のsubtune変更とStopでselector表示が復元されることも確認。
- [通常Playerでの実曲pilot](sid_player_models_local_01.json): 前回の固定planから`Bach4Xmas.sid`、`Mastermind.sid`、`Desert_Dream.sid`の既定subtune（1／1／4）を各約2秒、両engineで**6ケース成功**。Autoが8580を選び、実CPU／SID進行・profile Off・標本PCM有限／非zero・Stop後context終了を確認した。これは4つの非連続analyser窓の観測で、全frameを検査した30秒研究用Lab検証とは別の範囲。
- `npm run test:sid-corpus`: 10件、`npm run test:sid-reference`: 29件成功。旧corpus分類／参照CLIの制約を変更していない。
- 旧Player／RSID receipts、固定runtimeの33builds／68outputs／75mirrorsを確認した。CI YAMLを解析し、新しいmodel／共用probe／source kitの変更をtriggerするpathを追加した。GitHub Actionsでのremote実行はしていない。

Browser／実曲pilotの物理出力はgain0。今回も人の実聴ではなく、長時間・background・device変更の安定性確認でもない。前段階で観測したWebKitの処理予算超過や、DAC／digi・combined waves等の音質差は後続として残す。8580のPreview表示から実機精度・全曲互換・音切れなしを推定しない。

## 可読配布

[配布検証](sid_player_models_package_01.json)は7項目成功。ZIPのCRC／全219fileと展開後bytes、172個の元入力、16可読moduleのimport／asset閉包、4WASMのreceipt、8580の99compiled inputs／127source files・21notice filesを照合した。Rust／Emscriptenの再buildは今回やり直していないが、以前に独立buildで一致した99入力と同じsource／出力を保持する。配布を作るだけならRust／emccは不要で、再build手順と要求toolchainはkitへ記載した。

- `release/tetorica_sid_player_20261108-models_itch.zip`
- 219files／2,666,036bytes
- SHA-256: `6201acbeef92defb203a749c8109463778ae7b763125394299629fc12b0e6777`

JS／CSSは可読moduleのまま。既存6581／C64 source kitsに加え、`sources/sid8580-machine/`へ元source・marked adaptation・生成器・Rust／Emscripten noticesを同梱する。Native実行binary・GPL参照player・ゲーム曲／PCM／ROMは含めない。

作成commandは`node scripts/package_sid_player.mjs 20261108-models`。既存ZIPは上書きしない。README en／ja／英語AI引継ぎ・両home・Player guideと[TODO](todo_sid_01.md)を更新した。commit／push・tag・公開はしていない。

次はSID Synthの単体8580接続・model選択・Preset保存・API／型／Copy JavaScript。voice Envelopeが未提供のため、release尾と空きvoice管理を0扱いで誤判定しない設計が必要になる。
