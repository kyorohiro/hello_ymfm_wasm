# FM2612 Synth：VGMと手動操作の共存（2026-11-13）

DMGで固めた「自動演奏はVGMまたはCodeの一方、人は同じ音源へ手動で介入できる」をFM2612 Synthへ広げる。最初はYM2612 CH1〜CH6を対象とし、PSG／Mega CD PCM／PWMの再生と既存のLive・Pause試奏・Mixerは維持する。DMGの音量・再生経路と、ユーザーがstageした監査記録は変更しない。

- [x] YM2612のVGM書き込み・作者設定・Code・鍵盤・Looper／Event Rec・CH3特殊／CSM／DAC・seek cacheの所有権を整理する。
- [x] 選択したYM2612の曲CHを、再生中もつまみ／鍵盤で操作できるようにする。同じ実再生YM2612へ書き込み、VGMの位置や他のチップを停止しない。後のVGM命令は同じレジスターを上書きできる。
- [x] 古いLive表示から未編集フィールドを巻き戻さず、同一レジスターのpacked fields・共有LFO・OPマスクを正しく扱う。連続操作の表示戻りを防ぎ、Live Offでも手動の変更項目だけ更新する。
- [x] 手動Key Onの後にVGMが発音した場合、古いKey Up／Pitch復帰が新しい音を切らない。CH3特殊はモード・OP間の音程比を保持し、CSM／DAC等で鍵盤試奏できない状態は理由を表示する。
- [x] VGM／Codeは排他のままにし、音色の読み込み・作者設定の変更で自動演奏を止めない。Pause中の独立試奏・Copy to Synth・seek／cache・mute／volume・録音操作の既存制約を守る。
- [x] 再生バッファと入力反映の遅延を計測し、既存音量補正を保って、不要な音量増加や新しいバッファ過渡を導入しない。元のVGMデータや作者プリセットへの保存方針を説明する。
- [x] 実WASMを含むNode検証、gain0のheadless Chromium／WebKit、可読配布ZIP、使い方／CI／検証記録を更新する。実音出力・commit／push／公開は行わない。

実装範囲はまずFM6CH。PSG／PCM／PWMの再生中直接編集・鍵盤介入は後続TODOとし、これまでのPause試奏は使える状態を保つ。手動の曲CH編集は一時的な再生状態として扱い、作者音色へ残すには既存のCopy to Synthを使う。Synth側の作者編集や音色ファイル選択は保存対象にも反映する。Seekは元VGMから再構成し、手動介入を過去へ再適用しない。

実装済み：`synth_song_interaction.js` が同じ実再生コアへの操作と鍵盤所有権、`synth_fm_edits.js` がCode／作者側の部分レジスター更新を担当する。全体のNode検証551件成功。実WASMの旧版／新版32,768サンプルが完全一致し、全チップの補正値を維持。反映待ちは約47〜91ms（デバイス遅延を除く）、Seek後約87〜88ms。生成単位2048フレームは維持し、先読みを200msから45msへ短縮した。

最終候補：`release/hello_ymfm_wasm_fm-vgm-manual-20261113d_itch_synth.zip`。可読ソース・ZIP CRC・主なファイルのstage／archiveハッシュ一致を確認済み。D候補のChromium／WebKitで手動操作・Code併用・Seek／Cache・FM／PSG／PCM／PWM混合再生が成功。Liveの既存検証はC候補で両ブラウザ成功し、C／Dの289ファイルは表示フィールドのまとめ方を変更したhelperのみが異なることも確認した。使い方は [CODE.md](../synth/CODE.md)、検証記録は [verification_fm2612_synth_vgm_manual_20261113.json](verification_fm2612_synth_vgm_manual_20261113.json)。詳細ログは `build/verification/fm-vgm-manual-20261113/` と `build/verification/fm2612-vgm-manual-20261113/`。

後続候補：PSG／RF5C164の再生中直接編集。実聴・長時間・高負荷での確認は人の確認項目として残す。将来時刻を指定するCodeの `scheduleWrites()` はWorklet内で実行されるため、作者UIの即時レジスター観測とは別の対象。
