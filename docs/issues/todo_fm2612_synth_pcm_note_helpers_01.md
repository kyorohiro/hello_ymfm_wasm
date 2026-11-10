# FM2612 Synth Code：PCMの音名ヘルパー（2026-11-10）

ユーザー指摘：RF5C164に`noteOn()`がなく、音名を使う演奏でraw stepへの変換が必要。元サンプルの周期・基準音に依存するため、固定の256点1周期を前提にせず、既存PCM editorのsample rate／Root noteを使う。

- [x] `setNote(channel, note)`／`noteOn(channel, note)`をSynth CodeのRF5C164へ追加。音名またはMIDI 0〜127を受け取り、元sample rate・Root noteからraw stepへ変換する。`noteOff`は既存の短いsoftware releaseを使用し、raw `setPitch`／`keyOn`は保持する。
- [x] Root noteを「元sample rateで再生した音の基準音」として説明する。WAV／VGMの実音程を自動推定したとは扱わない。Root変更・音色変更・Stop後／準備待ちでも正しい設定を使い、不正入力で音を変更しない。
- [x] 型定義・補完の説明・Codeガイドを更新し、ユーザーの短いmelody例をPCMでも使えるようにする。音名→再生速度はソフトウェアの補助機能と明記。
- [x] 内蔵波形と任意sample rate／Root、異なるCH、境界値、不正入力、再発音・準備待ち／Stopを意味あるNodeテストで確認。必要なheadless確認は起動前から全speakerをgain 0へ迂回し、実聴しない。
- [x] cache key・配布ZIP・再開記録を更新する。commit／push／公開は行わない。

## 実装・検証記録

- Synth CodeのRF5C164 clientへ`setNote(ch, note)`と`noteOn(ch, note)`を追加。`noteOff()`は既存の短いsoftware release。チャンネル0〜7、音名またはinteger MIDI 0〜127を検証してから書き込む。`setNote()`はraw stepを返し、保持中の音を再発音せず変更できる。
- 変換は`sample.sampleRate / PCM_NATIVE_RATE × 2048 × requestedHz / rootHz`。実機のstep範囲1〜65535へ丸める。固定の波形長・周期は仮定せず、Root noteは手動の音程基準。VGMコピーの初期C4は取得時の再生速度を表し、実音程のC4を推定したものではない。Loop範囲変更後は必要に応じてRootを調整する。
- CodeでRAMを差し替えた場合は上段のmetadataを誤用しないよう音名helperを拒否し、既存raw `setPitch()`／`keyOn()`を案内。準備待ち解除直前にも検証し、途中のRAM変更による誤発音を防ぐ。Stop／上段音色への復帰で再度利用できる。
- 意味あるNode回帰161件成功（型定義の正負チェックを含む、失敗／skipなし）。任意97点sampleのmetadata、Root／rate変更、MIDI境界・不正入力、stepのみの変更、Code RAM差し替え、準備待ち中のNote Off／Stop／音色変更／同CH再発音・後続raw pitchを確認。ログ：`/private/tmp/fm2612-pcm-note-regression-20261110.log`。
- 起動前から全speaker接続をgain 0へ迂回するheadless Chromium／WebKitで実WASM出力を数値確認。内蔵SineのC4／A4、Root +12で同じ指定音の再生速度が半分、再発音なしの`setNote()`、release、ユーザーのE1 minorPentatonic loopとStopを確認。自作200 Hz／400 Hz WAVでは同じRoot指定音を弾いても元の周期が保たれ、指定音を+12すると各々2倍になることを確認。音程自動推定をしていないことも検証した。receipt：`/private/tmp/fm2612-code-pcm-notes-browser-20261110.json`。
- 型定義・補完の説明・[Codeガイド](../synth/CODE.md)・cache keyを更新。通常`sh scripts/package_itch_synth.sh`で配布ZIPを再生成。検証stage `release/itch_synth_pcm-notes-final-20261110`と通常stage／ZIPの全ファイル内容、およびbrowserに配信した全assetのbytes／SHA-256一致を確認。
- ZIP：`release/hello_ymfm_wasm_dev_itch_synth.zip`（1,056,977 bytes、281 files）。SHA-256：`dcb67ad36b8b7025769366c40b146fec80d81fe8e3028121b1aa00f8d2fcc6f2`。配信照合：161 assets。
- `git diff --check`成功。実聴・commit／push／公開はしていない。共有Playground／npm／Native APIは変更せず、今回の便利APIはSynth Code内のsoftware補助機能。

## 追加：CodeからRoot noteを指定（2026-11-10）

- [x] `pcm.setRootNote(note)`を追加し、音名／integer MIDI 0〜127で元サンプルの基準音を指定できるようにする。指定はCode側のsoftware tuningで、以降の`setNote()`／`noteOn()`に使う。既存のUI／保存音色を上書きしない。
- [x] 未指定・`null`はUIのRoot noteを参照。CodeのStop／新しい音色ではCode指定を解除し、Applyでは維持する。指定変更自体では保持中の音を再発音・retuneしない。UI Root変更でCode指定を二重適用しない。
- [x] 型定義・補完・ガイド、Rootとraw step／準備待ち・StopのNode回帰、無音browser実出力検証を更新する。
- [x] cache key・配布ZIP・再開記録を更新する。実聴・commit／push／公開はしない。

### Code Root指定の実装・検証記録

- `pcm.setRootNote(note)`を実装。音名／integer MIDI 0〜127を受け付け、実効RootのMIDI番号を返す。`null`でUI Root参照へ戻る。Code専用の宣言で、呼び出し自体はregister／RAM／キー／現在のstepを変更せず、以降の音名helperで使う。Apply保持、Stop／新しいPCM音色で解除。raw register resetでは宣言を保持する。
- 各CHの最後のstepがCode Root由来かを追跡し、そのCHだけUI Rootによる二重retuneを省く。raw `setPitch()`／`setChannel({step})`／step register書込みでは既存のUI追従へ戻し、音量・Pan・Loop変更はCode-tuned CHにも通常どおり反映する。準備待ち中のRoot変更も既存のpending stepは書き換えない。
- `setRootNote()`でCode RAMの未確定なtuning metadataを解消したとは扱わず、前段のCode sample-memory guardを維持。UI・保存音色は編集しない。
- Node回帰164件成功（失敗・skipなし）。型の正負、無効Root入力の原子性、MIDI0／127／null、raw操作との共存、pending noteの基準保持、reset／Stop／source復帰を含む。ログ：`/private/tmp/fm2612-pcm-root-note-regression-20261110.log`。
- 最終stage `release/itch_synth_pcm-root-note-final-20261110`でheadless Chromium／WebKit成功。すべて起動前からspeaker接続をgain 0へ迂回。setter自体の無書込み・保持音の維持、後続helperの2倍速、Apply保持、UI Root変更との独立、保存PCM JSONの不変、null解除、MIDI指定、Stop／新音色の解除、従来のWAV／melodyを実WASM出力配列で確認。receipt：`/private/tmp/fm2612-code-pcm-root-note-browser-20261110.json`。
- 型定義／補完説明／Codeガイド・cache keyを更新し、通常packageコマンドでZIPを再生成。検証stageと通常stage／ZIPの全内容、およびbrowserへ配信した全assetのbytes／SHA-256一致を確認。
- 更新ZIP：`release/hello_ymfm_wasm_dev_itch_synth.zip`（1,057,548 bytes、281 files）。SHA-256：`f9d5dfd94b66e996313a62e61e687e0df885892580c4a3cbd5cb3da0cda926b6`。配信照合：161 assets。前段のZIP記録を更新する最終版。
- `git diff --check`成功。実聴・commit／push／公開なし。今回もSynth Codeのsoftware補助機能に限定。
