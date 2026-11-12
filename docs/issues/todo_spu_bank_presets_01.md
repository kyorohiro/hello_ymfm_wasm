# SPU Synth：Bank／ToneのVAB・JSON保存とプリセット選択（2026-11-12）

- [x] Sound bank選択の横に「Save bank to presets」、Load selected Toneの横に「Save selected Tone to preset」を追加する。
- [x] 選択Bankを標準VABとして保存し、利用可能なToneのSPU JSONも補助として併存させる。選択Tone保存は1 Program / 1 Tone / 1 Sampleの標準VABとJSONの両方を作る。元Bankのヘッダー・Program/Tone属性・元ADPCMを保持し、不要な再エンコードをしない。
- [x] 元のBank、編集中の音色、PSFの再生／Pause、Codeを変更せず、SPU RAMへロードせずに保存する。
- [x] ADPCM、ループ、ADSR、基準音程、近似した左右音量・Reverb sendを保持する。共有Reverbは保存開始時の編集設定を使用し、PMON／Noise／MorphはOffにする。Unavailableは理由付きで集計する。
- [x] 名前の衝突を回避し、16 MiBのProject容量超過時は部分保存せず既存Filesを保つ。
- [x] Preset欄は標準VABのProgram／ToneとSPU JSONの両方を列挙する。VABからの選択は保存済みJSONに依存せず直接読み込む。Filesの追加・編集・移動・削除・Project復元に追従し、Keyboard／Codeの表示モードを維持する。選択後は演奏キーへ戻れるようにする。
- [x] VABをreadVab／prepareVabToneで解析し、既存SPU APIのloadADPCM／setPresetへ渡す使用例を記録する。現在VAB parserはPlayground／Synthのモジュールで、npmからは未公開であることを明示する（npm公開は今回行わない）。
- [x] FM2612のYM2612／PSG／PCMプリセット対応の現状を確認し、必要なら別TODOへ記録する。
- [x] Nodeと無音headless Chromium／WebKitで保存・再読込・再生状態維持・容量超過・狭幅を検証し、説明・キャッシュ・検証記録・配布物を更新する。

ユーザー追記：Tetorica独自JSONだけに依存せず、標準VABとJSONを両方残す。Bankは読み込んだ元VH+VBを保持する。任意の編集済みSynth音色からVABを合成する機能は今回含めない。通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。commit／push／公開はしない。

Node 361件とheadless Chromium／WebKit各9領域を完了。標準VABだけのProjectでTone直接読み込み、PSF Play／Pause維持、390px幅（両方scrollWidth 390）を確認。ZIPのCRCと全341ファイルのstage一致を確認。

配布物：`release/tetorica_spu_synth_bank-presets-20261112_itch.zip`。
検証記録：[spu_bank_presets_verification_01.json](./spu_bank_presets_verification_01.json)。commit／push／公開はしていない。
