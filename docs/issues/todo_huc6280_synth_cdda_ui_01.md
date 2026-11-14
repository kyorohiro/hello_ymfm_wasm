# HuC6280 Synth: CD-DAの基本UI

開始: 2026-11-14。MSM5205基本UIに続き、CD-DAタブの工事中表示をトラック再生UIへ置き換える。

- [x] 既存CD-DA player／PCM16 WAV／manifest／Worklet API、FilesとCassetteの容量を確認する。
- [x] Filesの対応WAV／track manifestを選択・読込し、トラック選択、
      Play／Pause／Resume／Stop、位置／時間表示、Seekを追加する。
- [x] 44.1kHz stereo PCM16・トラック番号・範囲を既存parserで検証する。
      読込・選択・停止中のSeekは受動的に扱い、成功前に以前の音声を壊さない。
- [x] 長い曲は専用の「Open session WAVs…」から扱い、Files／Cassetteの16MiB制限を保つ。
      session音声はProject保存・再読込へ自動的に含まれないと画面へ明示する。
      File参照を保持して選択した曲だけ読み、全曲のFloat32化・巨大JSON保存を避ける。
      既存CD-DAの256MiB PCM上限とsession件数／容量を境界で検証する。
- [x] UIとCodeで同じ編集用CD-DA source／トラック／位置を共有する。
      Code Stop後も音声を保持して停止位置を戻し、古いCode操作・遅延読込は無効化する。
      Apply、UI操作中のCode継続、workspace置換、出力切替、通信失敗からの復旧を揃える。
- [x] Mixer／Master／monitorの既存経路を使用し、VGMと別の音声トラックであることを明示する。
      CD-DA側の操作でHuC6280／MSM5205やVGMを不用意に止めない。
- [x] 型・補完・使用例・README・配布ZIP・CIを更新する。
      実WASMと実配布ZIPのChromium／WebKitを消音で検証し、記録を残す。

今回の範囲外: 実CD-ROM／ISO／CUE／BIOS／ゲームの実行、圧縮音声の自動変換、
CD-DAへ音程・Rateを付ける機能、共有SDK／WASMの変更、Tauri反映・公開・npm publish・git commit。

## 実装

CD-DAタブへSource／Track選択、Play／Pause／Resume／Stop、時間表示とSeekを追加した。
FilesのWAV／manifestはLoadで読み込み、長い音声はOpen session WAVs…から開く。
読み込み・選択・停止中のSeekはAudioContextを生成しない。manifestの相対パスは
読み込み元へ固定し、Codeの実行ファイルが変わっても参照先を変えない。

SessionはFile参照を最大99件・合計512MiBまで保持し、選択したWAVだけを読み込む。
1trackのPCM上限は256MiB、WAV全体はheader余裕を含め256MiB＋1MiB。
256MiBを超えるファイルは選択時にheaderだけ先に調べ、PCM上限超過を全体確保前に拒否する。
Project／Cassetteの合計16MiBは変更せず、session音声は保存・export・reload recoveryへ含めない。
元WAVを保管して再度開く必要がある。Clear session WAVsはsession依存のsourceだけを消し、
独立したProject sourceと他音源を保つ。sessionパスを再利用せず、古いCode参照を別音声へ接続しない。

UIとCodeは同じsource／track／cursor、既存のMixer／Master／monitorを共有する。
Code Stop開始時に古いCode権限と保留読み込みを無効化し、発音はフェード完了後に停止する。
独立したUI読み込みは維持し、loaded sourceは先頭へ戻して再利用できる。
Apply、遅延したnative upload、停止直後の再Play、RPC timeout後の復旧を扱う。
Seekのblur／非表示／Escape／pointer cancelや、別sourceへの切替で古いドラッグを確定しない。

## 検証

Node604件が成功、失敗・skipなし。配布ZIPの112 readable modules・152 original inputsと
6 runtime artifactsの一致を確認済み。Chromium／WebKitの同じ最終ZIPで、
新CD-DA＋既存12スイートの計13 suite／26 run／236項目がすべて成功した。
共有SDKは0.1.8-huc-stateのまま。人の実聴・実ゲーム比較・長時間試奏は未実行。
[検証記録](verification_huc6280_synth_cdda_ui_20261114.json)。

手動確認では、CD-DAで対応WAVを開いてPause／Resume／Seekを試し、HuC6280のCodeを
鳴らしたままCD-DAのPlay／StopとMixerを調整する。長いsession WAVは保存対象外なので、
Cassetteを復元した後に元WAVを開き直す。Tauri反映・公開は後続の作業として残す。
