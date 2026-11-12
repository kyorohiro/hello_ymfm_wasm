# DMG Synth：Code・Files・Live表示（2026-11-12）

FM2612／SID／SPUの構成をDMGへ横展開する。同じ1台のAPU・既存の音色編集・Master・monitorを共有し、`useSoundChip("gameboy")`で物理CHを操作する。Pulse×2・Wave・Noiseは既存APIを使い、ハードウェアのCH構成を保つ。

- [x] 既存APU／API／型・共通Code／Files構成を調査し、Codeの借用・Stop時の編集状態復帰・非同期要求の境界を決める。
- [x] 同じAPUを借りるCode endpointと、Run／Apply／Stop・FX／出力fade・古い要求の拒否を接続する。Code終了時は元の音色・Wave RAMを復帰する。
- [x] Keyboard／Codeタブ、Monaco・補完／可読ソースへの移動・最大化、Files・右クリック基本操作・ローカル保存／project入出力を追加する。復元やimportだけでは音を鳴らさない。
- [x] 物理CH1–4の読み取り専用Live表示を、既存Pulse／Wave／Noise編集UIへ接続する。既定On・Off可能・上限20Hz／同時1要求、観察で保存音色を書き換えない。
- [x] Node／実WASMと無音headless Chromium／WebKitで、Code・Files・Live・Stop／pagehide・既存鍵盤／VGM import／モバイル幅を検証する。
- [x] 可読ソース付き配布ZIP・cache／README／CIと検証記録を更新する。

最初の既定index.jsは現在選択中の音色を使い、PulseならCH1、WaveならCH3、NoiseならCH4を発音する。4CHの個別設定は既存公開APIで明示できる。演奏用の新helper・Looper／Event Rec・曲再生はこの作業には含めない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前から全destinationをgain0へ遮断し、Chromiumはmute指定。実聴せずWASM PCMを数値で検証する。commit／push／tag／npm公開／itch公開は行わない。既存のstagedファイルは保持する。shared runtime／WASMは必要性が確認された場合だけ変更する。

## 完了記録

- 1台の既存APUを非同期Code endpointへ貸し出す。Run前にkeyboard Pitchを0へ揃え、native checkpointと送信／設定registersを保持。Stopで元の音色・Wave RAMを復帰する。Applyはleaseを保持する。
- Keyboard／Code、Filesの基本操作・context menu、JSONの同じCode editor表示、local save／Cassette、Monaco／補完／可読source移動、最大化を接続した。
- LiveはCH1〜4を既存UIで読み取り専用表示。初期volume・送信period・Wave RAM等であり、実hardwareの現在Envelope値／Sweep進行値は観測できないことをUI・guideへ明示した。
- 実sharedruntimeでWave／Noiseのnested APIのstopLoop解放漏れを再現したため、共有Code runtimeにoptional `resolveNoteTarget` hookを追加。DMGだけがnested／root別名を同じ物理CHへ対応付ける。従来hostのdefault挙動を維持し、古いloopが新しい物理CH所有者を消さないことも検証した。WASM・shared GameboySynth APIは変更していない。
- Node／WASM／型／Files／package 83件、共有runtime＋既存SPU／SID Code音声の31件が成功。runtime artifact整合（33 SDK builds／68 outputs／75 mirrors）も成功。
- 最終ZIPのCode・実Monaco・既存DMG browserはChromium／WebKitで成功。readonly名欄EnterでもCodeを止めず、非0のkeyboard PitchをRun前に0へ揃え、Stop後も0を保持することを追加検証した。
- 最終候補: `release/tetorica_dmg_synth_dmg-code-files-live-final-20261112_itch.zip`、118 files／1,764,871 bytes、SHA-256 `4e0ba15e7619efbec0c6c32e9df94febfd803013bafc775c9d68988da544f4d0`。JS／CSSは可読module、APUと既存software FXのみのWASMを同梱する。

- Codeの実4CH PCM、Stop fade後の無音、Apply保持、旧client拒否、全4CHの同じUIでのLive、local restore時の無audio、JSONの非実行編集、可読sourceへの移動、390pxを確認。実聴は未実施。
- 配布modules 69件は最終workspaceとbyte一致。CIへCode／Monaco checkerを追加した。commit／push／tag／npm・itch公開は行っていない。
- 詳細：[検証記録](dmg_synth_code_files_live_verification_01.json)。再実行方法は[DMGガイド](../synth-dmg/README.md#build-and-verify)。
