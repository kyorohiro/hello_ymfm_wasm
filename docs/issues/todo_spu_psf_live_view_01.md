# SPU Synth：PSF CH Live表示（2026-11-11）

PSF再生中のCH1〜CH24を選び、既存PCM／ADSR／FX画面で観察する。LiveはデフォルトOn、Offで編集音色の表示へ戻せる。音声の先読み位置ではなく再生位置に対応するsnapshotを表示し、Pause中は表示も固定する。Capture／Pause試奏は次の別作業。

- [x] 共通SPUの読み取り専用snapshotと既存Code Live／panelの状態形式を調査し、実装の分担・境界を決める。
- [x] PSF coreのregister／波形情報を副作用なく取得できるようにする。固定SDK／DSP本体は変更しない。24CH・Noise・PMON・reverb・実波形の制限を明確にする。
- [x] transportの音声位置に対応するsnapshot履歴を有界に保持する。Live Offの負荷削減、Pause／Resume、Stop／曲変更、古いsnapshot排除を検証する。
- [x] CH1〜CH24／Live On-Offをコンパクトに追加し、既存PCM／ADSR／FXの表示を再利用する。観察中は読み取り専用、Off／Stopで編集音色へ戻す。Code Liveとの競合を防ぐ。
- [x] 自作PSFを使う数値テストとChromium／WebKitの無音headlessで、音声時刻・Pause固定・CH切り替え・Off／Stop復帰・編集音色保持・ownership・レイアウトを確認する。
- [x] README／配布ソース・ZIP／検証記録を更新する。commit／push／tag／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmuteを併用する。一般PSF全互換、実聴・長時間検証、Capture完了は主張しない。

実装方針：core.observe()は24CHを副作用なく読み取り、1CH最大4 ADPCM packet／112点の冒頭プレビューを返す。GateはCPU KON／KOFFの要求、active／ENV／ENDは別に示し、ENDを停止と誤認しない。transportは2205 native frames（20Hz）ごとのsnapshotを有界に保持し、scheduled PCMの消費位置以下の状態だけを選ぶ。必要なrender分割でAudioBufferの構成やPCMは変えない。既存Code Live toolbarと同じ編集パネルを再利用する。

数値検証：関連Node 412件、音量校正145件が成功。core／observer 24件とtransport 21件は上記に含む。実PSFを4秒／80 snapshot読み取り、LiveなしとPCM完全一致（CPU／SPU RAM不変も自作fixtureで検証）。固定SDKは変更なし。共有sourcekit 182 filesと生成JS／WASMは独立再ビルド済み内容に一致。

WebKitのPause入力問題を単体DOMで再現：同じtextContentを25msごとに置換すると100回中4回／25回のclickが消失（押下0ms／5ms）。ラベルが変わる時だけ更新する方式では両条件100／100回成功。Pause／Resume・Liveラベル・Extract VABをno-op更新しないよう修正し、最終配布物のWebKitで30往復／61 trusted clicksすべてが成功した。

次のCapture実装では、Live snapshotは最大4 packetの観察用データである点に注意する。先読み済みcoreの現在RAMをPauseの聴こえた時点のRAMと同一視せず、選択CHの同時点サンプルを取得する方式を別に設計する。今回のLive表示は音色の完全なCaptureやRoot note推定を行わない。

完了：最終d ZIPでfocused Live・PSF transport・Code／Files・通常SynthをChromium／WebKitで無音検証し、すべて成功。通常SynthのPCM連続性、Noise時のMorph非表示／復帰、Codeの音色／RAM復帰も確認済み。

検証記録：[spu_psf_live_view_verification_01.json](spu_psf_live_view_verification_01.json)。配布候補は `release/tetorica_spu_synth_psf-live-20261111-d_itch.zip`（332 files）。80個の可読ブラウザmoduleはauthoring sourceとbyte一致し、ZIP CRCも正常。commit／push／公開はしていない。
