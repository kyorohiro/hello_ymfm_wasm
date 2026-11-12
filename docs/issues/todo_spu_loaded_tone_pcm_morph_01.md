# SPU Synth：読み込んだToneのPCM編集とSoftware morph（2026-11-12）

- [x] Load selected Tone後のADPCM preview／PCM編集／Morph切替を確認し、編集可能な短いPCMと取り込んだADPCMの扱いを整理する。
- [x] 読み込んだToneの全体PCMを編集できるようにし、112点Morphへの無言の置換を防ぐ。ソフト側の編集／ADPCM量子化を明示する。
- [x] 元音色のサンプル・ループ・音程・ADSRを不用意に壊さず、保存／再読み込みと既存PCM描画を維持する。
- [x] 適切なNode／実WASMおよび無音headless検証を行い、説明・キャッシュ・検証記録を更新する。commit／push／公開はしない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。

初期調査の記録：

- Tone読込は元ADPCMとサンプルの音程／ループを保持し、編集用`waveform`はnull。表示は最大112点の読み取り専用`adpcmPreview`なので数値／ドラッグ編集は無効。
- Morph Onは読み込んだADPCMからAを作らず、既存／既定のA（Sine）・B（Saw）を112点cycleとしてprivate編集slotへ適用する。元Toneの波形がそのままMorphへ移る機能はまだない。
- 自作VABのChromium無音診断ではcanvas自体の消失は未再現。Morph On後にcanvas／祖先はvisible、描画あり、数値編集はenabled、JavaScriptエラーなし。診断：`/private/tmp/spu-vab-morph-diagnostic.json`。
- ユーザー回答：「サンプル全体を、元の長さ・ループを保って編集したい」。112点へ自動切り詰めない。先頭previewだけを元のサンプル全体や正確な1周期として扱わない。

WebKitでも自作VABの非Sine Tone（P11/T0、16B／28 samples）で単発診断済み。Morph Onで既定Sine 64B cycleへ切替、canvasは表示・描画・数値編集とも有効、errors／consoleErrorsなし。診断：`/private/tmp/spu-vab-morph-webkit-diagnostic.json`。通常browser／音出しなし、この診断時点では製品コードを変更していなかった。

実装方針（ユーザー回答後）：

- [x] ADPCM全体をprepare側で復号し、全体表示・範囲拡大・数値／ドラッグ編集を用意する。長さ、Repeat／Loop Start、基準周波数、ADSR、音量、リバーブ設定を保持する。
- [x] 編集後はprepare側でADPCMへ再エンコードして実SPUで再生する。元のbank bytesは変更せず、編集用slotを再利用する。容量不足／古い編集結果／不正データは適用前に拒否する。
- [x] 全体サンプルと112点周期の編集を区別する。全体sampleのMorph Onで既定Sineへ無言で置換しない。長いsample全体のMorphは今回の対象外。
- [x] 再エンコードの量子化を説明し、保存／再読込・Tone再選択・Code／PSF表示切替・失敗時の音色保持を検証する。

実装・検証完了：全体PCMの表示／数値・ドラッグ編集／ズーム／Worker Cancel／編集slot再利用／保存再読込。Node 326件（skipなし）、native復号914,004 samples完全一致、無音Chromium／WebKitで全体編集とpaused PSF編集、390px表示を検証済み。

検証記録：[spu_loaded_tone_pcm_verification_01.json](./spu_loaded_tone_pcm_verification_01.json)。最終ZIP：`release/tetorica_spu_synth_full-sample-20261112_itch.zip`。commit／push／公開はしていない。
