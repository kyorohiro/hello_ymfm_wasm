# HuC6280 Synth: VGMを止めずに同じCHを操作する

開始: 2026-11-14。Codeとの共存に続き、VGM再生中の選択CHへ手動の
ハードウェア設定・発音・Pitchを送る。VGMとCodeの同時実行は行わない。

- [x] 既存のVGM音源・parser・先読みPCM・聞こえた位置のLive表示を調べる。
      手動writeは同じ参照音源の未生成境界へ挿入し、既に生成したPCMを捨てない。
      音と表示は同じ時刻で反映する。別音源への複製で同じCHの操作を代用しない。
- [x] 物理CHのつまみは変更したhardware項目だけを安全に反映する。
      未知のWave RAM／controlを推測しない。Software Envelope／PCM資産は曲から借用しない。
      後のVGM命令は該当項目へ通常どおり書き込める。
- [x] Wave／Noise／LFOの鍵盤発音とPitchを接続し、後のVGM gate／周波数writeと
      古い離鍵／Pitch解除が競合しないようにする。DDAの瞬間DAC値をPCM音色と見なさず、
      鍵盤で試せない状態は理由を表示する。Pause中の既存試奏／Captureは維持する。
- [x] CH変更・blur・Pause・Stop・Seek・Code Run・曲／project／出力切替で
      手動所有権を解放し、遅延した操作を新しいrunへ渡さない。
- [x] 手動変更後のrunからは原曲用checkpointを収集しない。既存のclean cacheは保ち、
      Seekでは原曲状態へ戻す。取消時は元の編集済みrunと未消費PCMを保持する。
- [x] Synth選択時の編集用音色と鍵盤もVGMを止めずに使えるようにし、
      参照CH操作との違いを既存の表示で伝える。追加タブや恒常的な長い説明は増やさない。
- [x] 実WASMの書込順序・PCM・Live時刻・所有権・取消・cacheを検証する。
      読めるソースを含む同じ独立ZIPでChromium／WebKitを無音検証し、
      README／CI／仕上げTODOと検証記録を更新する。

VGMファイル・編集用プリセットは手動の曲CH操作で書き換えない。
先読み分を通過した先から反映するため、短い出力遅延がある。
共有SDK／WASMの変更・npm公開・Tauri取り込み・commit／stage／push／tagは行わない。
物理音声出力・実聴は行わない。

## 実装記録

同じreference nativeへ同期writeを送り、既存PCMを保ったまま未生成境界へ反映する。
Liveは聞こえた位置で更新し、操作中のつまみ・波形のdraftはすぐ表示する。
Auto update Offでも自分の変更はその音の境界で一度確認でき、以後の自動更新はOffを保つ。
手動gate／pitchは項目ごとの所有者を追い、後のVGM control／Wave／frequency writeを保護する。

曲CHではSoftware Envelope・PCM資産・LFOのFollow modeを設定しない。
DDAはlevel／balanceを編集できるが、瞬間DAC値だけから鍵盤PCMは作らない。
Synth選択時にはVGMと同時に、自分の音色の全機能・音色読込・鍵盤を使える。
物理CH表示中の明示的な音色読込は従来どおり参照演奏を止め、編集用音色へ読み込む。

独立したmanualEpochで、Pause／Resume／Seek／source検証の開始や失敗後も古い入力を拒否する。
Live観測の失敗はmanual helperだけを無効にし、Pause・Seek・新しいLoadを妨げない。
手動変更したrunはclean checkpointを増やさず、Seekで原曲に戻り、取消は編集済みrunを保つ。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_vgm_manual_20261114.json)。Node437/437、skipなし。
同じ独立ZIPでChromium／WebKitの全10スイート・20実行・194項目が成功。
1240px／390px画像を確認し、121入力と配布物の整合性を検証した。
新しいVGM手動操作検証をCIへ追加し、既存Code／Song／Live検証のCLI引数も修正した。
共有WASM／SDK／npm API・native repositoryは変更していない。
実聴・長時間実ゲーム比較・Tauri取り込み・公開は未実施。commit／stage／push／tagなし。
