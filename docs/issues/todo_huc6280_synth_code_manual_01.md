# HuC6280 Synth: Codeと手動操作を同じCHで使う

開始: 2026-11-14。VGMへの手動操作に進む前に、Codeの自動演奏と
つまみ／鍵盤を同じHuC6280上で共存させる。

- [x] 現在のCode／Keyboard切替・物理CH表示・つまみ・音色読込の停止条件を調べ、
      Codeのloop／context／接続を保ったまま操作する経路を揃える。
- [x] CH選択中のつまみは表示中のCHへ、Synth選択中は共通音色へ反映する。
      後から来るCodeのパラメーター変更を保ち、選択変更だけでCHの値を統一しない。
- [x] 鍵盤の発音・離鍵・Pitch・blur／Octave変更がCodeの発音を誤って消さないようにする。
      同じCHの新しい発音や自動writeを、古い手動操作が巻き戻さないことを確認する。
      Wave／Noise／Hardware LFO／DDAの所有権と停止対象を確認する。
      既存の「古いCodeの離鍵で新しい手動発音を切らない」扱いも維持する。
- [x] Code表示中もエディターへの文字入力を守り、演奏可能な範囲から鍵盤を操作できる。
      Keyboardへ切り替えてもCodeは継続する。Stopは明示的な全停止として維持する。
- [x] 実WASM／Workletと独立ZIPでChromium／WebKitを無音検証する。
      既存Code・Files・Live・VGM・Seek／Cache・Captureを保ち、README／CIと検証記録を更新する。

今回はCode＋手動操作まで。VGM＋手動操作、Tauriへの取り込み、公開・tag・
commit／stage／pushは行わない。物理音声出力・実聴は行わない。

## 今回確認した既存経路

Codeを維持するKeyboard／Code切替、選択CHへの疎なつまみ編集、共通音色／Files読込は既存実装。
今回新たに、Code表示中のFocusに応じた鍵盤入力、遅延Pitchのsession／epoch検証、
手動Release tailの後始末、DDA供給終了後も混在するWave／NoiseのEnvelope更新を追加・修正した。

古いCodeのnoteOff／keyOffで新しい手動発音を切らない既存方針は変更しない。
後からのCode noteOn／keyOnは新しい所有者になり、周波数変更後の手動Pitch解除は元へ戻さない。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_code_manual_20261114.json)。Node413/413、skipなし。
同じ独立ZIPで、新しいmanual検証6項目と既存8スイートをChromium／WebKitで実行し、
全9スイート・18実行・182項目が成功した。1240px／390pxの表示も確認済み。
全出力はアプリ起動前からgain0、実聴なし。共有WASM／SDK／npm APIは不変。
CIにmanual検証を追加。Tauri取り込み、commit／stage／push／tag／公開は行っていない。
