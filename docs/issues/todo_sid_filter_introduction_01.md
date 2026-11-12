# SIDのフィルターを学ぶ動く入門（2026-11-12）

- [x] 既存Introduction・SID Synth／Playground／npm APIを確認し、一次資料と実装に基づいて説明範囲を決める。
- [x] 自作の同じSaw音で、Bypass／LP／BP／HP・Cutoff・Resonance・3CH共有routingを比較する小さな実験UIと読みやすい編集用コードを作る。再生は明示操作のみ。
- [x] 日英の短い読み物を既存`docs/introductions/`に追加する。操作→観察→説明→コード改造をつなぎ、ハードウェア機能／Tetorica近似／JavaScript制御を区別する。
- [x] Synth／Playgroundへの入口と既存npm filter例へつなぐ。README Goalの理解・学習・組込・知識保存に対応し、新しいSynth／プレイヤー機能を増やさない。
- [x] 実WASMでサンプル・切替・停止／解放と比較の数値根拠を確認する。Chromium／WebKitで両言語・狭幅・操作・外部リンク／consoleを無音検証する。
- [x] 入門一覧・必要な配布依存／cache／検証記録を更新する。

範囲: 最初の一章「SIDのフィルターで音の明るさを変える」。一つのSIDと自作の単音／3CHだけを使う。モデル比較・Sync／Ring・ゲーム曲解析はこの章へ詰め込まない。Cutoffはhardware codeで、Hzへの正確な換算は主張しない。音色の主観的評価と測定結果を混同しない。

通常browser／native app・音声デバイス・OS音量は操作しない。headlessは全destinationをアプリ起動前にgain 0へ通し、Chromiumはmute指定。commit／push／npm公開／itch公開は行わない。shared runtime／WASMを変更せず、説明用の著作物は自作する。

完了: [日本語](../introductions/tetorica-sid-filter_ja.html)／[English](../introductions/tetorica-sid-filter.html)。MOS／Commodoreの原6581データシート（印刷p2／5／6）を参照し、本文・音・コードを独自に作成。単音Sawと任意の3音、共有routing、固定目盛Spectrum、現設定を反映するPlaygroundコード、既存npm `02-filter`例へ接続した。Bypassはoff＋routing0、コードとHzは区別し、モデル近似・hardware／software境界・コピー例の4秒演奏と出力Gainの違いを明記。

`npm run test:introductions`61件成功（新SID数値11件を含む）。Chromium／WebKit×日英の4経路、1180px／390px表示、keyboard操作、同じ保持音でFilterのみ更新、コード／リンク一致、自動再生なし・起動取消・Stop／pagehideでの解放まで成功。デスクトップ／スマホの画像も目視確認済み。全検証はミュートし、実聴はしていない。

WebKitではclose済みContextが直後にrunningと報告される事象を実際に記録し、引退したContextだけを再closeするstatechange guardを追加した。最終4経路の16Contextと、追加のWebKit2経路の8Contextがすべてclosed。guard適用後の2回目close発火自体は今回の最終runでは起きず、その点を検証記録へ区別して残す。動的JS／WASM待ちのStopも遅れて音源を起動しない。

恒久記録: [sid_filter_introduction_verification_01.json](sid_filter_introduction_verification_01.json)。元ログ／画像は`/private/tmp/sid-filter-introduction-*`、metadataログはignoredの`build/sid-filter-introduction-20261112/`。トップ／README日英／既存入門にリンク済み。Node／無音browserの専用GitHub Actionsを追加（remote実行は未実施）。記事は静的docs配信で、既存Synth／Playgroundのitch ZIPへ依存を足す必要はない。shared runtime／WASM・npm・公開状態は変えていない。
