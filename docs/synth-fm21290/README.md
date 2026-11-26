# Tetorica FM21290 Synth

[Browser版](index.html) · [レジスタと根拠](registers.md) · [作業状況](../issues/todo_fm21290_synth_01.md)

この開発版はDX7音色をYM21290（EGS）／YM21280（OPS）の実験用コアで演奏する。ローカルで使う場合はリポジトリのルートで `python3 -m http.server --directory docs 8080` を実行し、`http://localhost:8080/synth-fm21290/` を開く。

**Synth** では上段のOutputで出力を確認しながら、中央の **YM21290 / Register / Mixer** と下段の **Keyboard / Code** を独立に切り替えられる。**Codeモード** は同じOutputの下に5枚を一列のタブとしてまとめる。YM21290の **AUTO** は音源に声を割り当てさせ、**CH1〜CH16** は指板から鳴らす物理声を指定する。CHボタンの緑は発音中、琥珀色はリリース中。白い枠が手動で選んだ演奏先を示す。

**Operator envelopes** のR1〜R4・L1〜L4は、図・数値・`setOperator`から変更できる。押鍵中にL3を動かすと、現在の音量から新しいレベルへR3の速さで移る。離鍵後もリリースが続いている間はR4・L4が効く。

**Keyboard** はFM2612と共通のギター指板。数字・Q・A・Zから始まる4列が弦に対応し、各パッドにPCキーと音名が出る。Octaveの中央の値を左右にドラッグするか、− / ＋を押して−3〜＋3オクターブを切り替えられる。PCキーによる演奏はKeyboardタブを閉じても使える。Code本文などのテキスト欄では文字を入力できる。Ctrl / Cmd + EnterでRun、Shiftを加えるとApplyでき、Codeを閉じた状態からも実行できる。左右の矢印でフレットを、上下の矢印で表示する弦を移動できる。Guitar / Bass / Ukulele、開放・5・12フレットの切り替えにも対応する。

**☰ Menu → New → Cassette** で初回起動と同じ `/index.js`、`/examples` のコード・演奏MIDI、標準プリセットを含むCassetteを作成する。確認画面で現在のCassetteを書き出してから切り替えることもできる。

**Files → presets** で音色ファイルを選ぶと、その音色をすぐに演奏・編集できる。Filesボタンは左のCassetteツリーを開閉する。**＋ JS** で新規ファイルを作成できる。ツリーからテキストを選ぶとCode、SysExを選ぶとYM21290内の音色設定が開く。左上の **☰ Menu → Export** で、プロジェクト全体（Cassette · ZIP）、音色（Voice · SysEx）、Codeを保存できる。

**☰ Menu → Import** にはDX7 voice · SysEx（単音色・32音色バンクの.syx）、MIDI（.mid／.midi）、Cassette（.zip）が並ぶ。読み込んだMIDIはFilesのsongsフォルダに保存される。Escで閉じる。画面の切り替えはタブとFilesボタンで行う。

最初の音色はオリジナルの **GLASS STEP**。Codeの **Run** でCH1の低音とCH2のベルが始まる。`0x30c1` への書き込みを36から12に変え、**Apply** するとCH2のOP2による変調が深くなる。**Stop** で停止する。MixerタブのDX7 volumeで音源の出力を、画面上部のMasterで最終音量を調整する。どちらも0〜480%（DX7 volumeの初期値は220%）で、倍率は掛け合わせる。Outputの **Waveform / Spectrum** ボタンでMaster後の波形・スペクトルを切り替える。MasterやMixerをマウスで調整した直後もPCキーで演奏でき、Code入力中ならエディタに戻る。Tabでスライダーを選ぶと矢印キーで値を調整できる。

**After the Chime** はTetoricaオリジナルの6小節の演奏MIDI（96 BPM、15秒）。Filesでexamplesの **after-the-chime.mid** を選び、**Play MIDI** を押すと現在の音色で鳴る。冒頭2小節の和音と旋律を強く弾き直し、最後の2小節は単音の余韻を残す。プログラムチェンジは含まない。同じ演奏でエレピとベルの音色を比較できる。[演奏MIDI](examples/after-the-chime.mid)

**Register Key On** はEGSのキーイベントを試すCodeサンプル。OPS / EGSでFiles → examples → register-key-on.jsを開いてRunすると、CH1の音高とOP出力を準備し、`0x30F1` への書き込みだけで同じラを短く、次に長く鳴らす。RegisterタブにはCH1の打鍵 `30f1  01` と離鍵 `30f1  02` が残る。[Register Key Onのコード](examples/register-key-on.js)

**Held Envelope** はEGSのレジスタを直接書き換える約5秒のCodeサンプル。Files → examples → held-envelope.js → Run。CH1とCH2でドとソを伸ばし、OP1のL3（0x3076）を16、0の順に書くと、両方の音が小さくなって戻る。最後は離鍵後にR4（0x3057）を上げて余韻を切る。[Held Envelopeのコード](examples/held-envelope.js)

**Return Steps** はAlgorithm 4の帰還を聴き比べるCodeサンプル。Filesのexamplesからreturn-steps.jsを開く。Glass Echoと一緒にCassette ZIPに同梱される。OPS / EGSでRunすると、演奏用の音色を設定する。同じ4音をCH1（FB 0）とCH2（FB 7）が交互に演奏する。[Return Stepsのコード](examples/return-steps.js)

Algorithmの下に出力の式を表示する。矢印は変調先、+ は加算を示す。各OPの色はエンベロープ図と共通。OPをクリックするかTabで選んでEnterを押すと、そのOPの行と4段のレベル図が選択される。Algorithm 4ではOP6 → OP5 → OP4を通り、OP4からOP6へ戻る。

YM21290内の **Operators** にはOP1〜OP6が並ぶ。**Oscillator / Envelope / Scaling** で比較する項目を選ぶ。左右の **− / ＋** で1段階ずつ、中央の値を左右にドラッグして連続調整できる。中央の値にフォーカスすると左右の矢印キーでも調整できる。**Operator envelopes** ではOP1〜OP6を色分けして一つの図に重ねる。色付きのOPボタンで対象を選ぶと、その線が手前に太く表示され、下の表もEnvelopeに切り替わる。表のR・L値を編集すると、図の数値表示は同じOP・同じ段に追従する。選択した線の点1〜4を上下に動かすと対応するL値、左右に動かすとR値が変わる。左ほど速く、上ほど高い。各点の横位置はその段内のレートを表し、実時間を表すものではない。始点の高さはL4に連動する。点にフォーカスすると矢印キーで1ずつ調整できる。

Algorithm（1〜32）とFeedback（0〜7）は− / ＋または中央の値の左右ドラッグで変更できる。**Oscillator key sync** は各音色のON / OFFボタン。OPS / EGSでオンにすると押鍵時に6つのOPが位相ゼロから始まる。オフにすると、同じ物理CHでも打鍵間隔によって波形の開始位置が変わる。LFOのKey syncは別に設定できる。

**LFO** は全声共通。独自エンジンで音高の揺れを試すには、Sine、Speed 40、Pitch depth 40、Pitch sensitivity 4にして鍵盤を長押しする。振幅の揺れはAmplitude depthと各OPのAM sensitivityで調整する。Register writesにはAMとPMの現在のバイト値が出る。

**Pitch envelope & LFO** の数値と波形は− / ＋または中央の値の左右ドラッグで変更できる。LFOのKey syncはON / OFFで切り替える。画面幅が狭いときは、OperatorsのEnvelopeをOPごとに折り返してR1〜R4・L1〜L4を表示する。

**Pitch envelope** は各声の音高を押鍵から離鍵まで変化させる。INIT音色でL1〜L3を82、L4を50、R1を60にしてA4を長押しすると、440 Hzから880 Hzまで上昇する。あとから弾いた鍵は、その鍵の押鍵時点から上昇する。

## JavaScript

Code欄の **Enable code completion** で既存Synthと共通のMonacoエディタを開く。`const chip = await useSoundChip('fm21290');` に続いて `chip.` と入力すると、物理CHの `keyOn` や `writeRegister` を選べる。`midi.createPart()` の戻り値には `sustain` や `pitchBend` が出る。Ctrl+Spaceで候補を開き、Enterで確定する。RunはCtrl+Enter（macOSはCmd+Enter）、ApplyはさらにShiftを押す。初回のエディタ読み込みにはCDNへの接続を使う。読み込みに失敗しても通常のテキスト欄で編集・実行できる。

- `await useSoundChip('dx7')` は既存Code用の互換名で、同じOPS / EGSコアの `noteOn(note, velocity)`、`noteOff(note)`、`getPreset()`、`setPreset(preset)`、`setOperator(1..6, patch)`、`setFeedback(0..7)` を使う。
- 通常は `await useSoundChip('fm21290')` を使う。同じハンドルで上記の演奏・音色編集に加えて `keyOn(CH1, 60, 100)`、`keyOff(CH1)`、`writeRegister(address, byte)` を使用できる。CodeのCH定数は0始まり、画面のCH表示は1始まり。アルゴリズムはAPIで0..31、画面で1..32。
- 独自コアのCodeでは `chip.setSustain(true)` を呼び、`noteOn` → `noteOff` で鍵を離しても音を保持できる。`chip.setSustain(false)` でペダルを戻す。物理CHを指定する `keyOff(CH1)` は即座にゲートを切る。
- AUTOは16声から空いた発音枠を探索する。物理CH指定は同じ枠を再トリガする。

### サンプル時刻で演奏する

Files → examples → **scheduled-echo.js** で、2音を繰り返すフレーズを編集できる。`chip.build(b => { ... })` は同期コールバック内の `keyOn`・`keyOff`・`writeRegister` をレジスタ列にする。打鍵の音高・出力はbuild時の音色から計算する。`b.atSeconds(t)` または `b.atSample(n)` で先頭からの時刻を指定する。サンプル単位の基準は既定48 kHzで、同じ時刻の書き込みは記述順に適用する。

`await chip.compile(plan)` で番地・値・秒オフセットを確認できる。`await chip.schedule(plan, {name:'fifth', repeatSeconds:1})` で音声スレッドに予約する。単発演奏ではrepeatSecondsを省く。Applyでエントリーの予約を差し替え、Stopで取り消す。`await chip.clearSchedule('fifth')` は指定した予約を解除する。

`liveFx(name, {context, process})` でチップ出力とMixerの間にエフェクトを挿入する。KeyboardとMIDIにも同じ処理がかかる。例の `gain: 0.6` を書き換えてApplyすると音量が変わる。Stopで直接出力に戻る。

## MIDI出力

FilesでMIDIファイルを選ぶと **Play MIDI / Stop MIDI** が表示される。外部機器の設定、パート選択、再生区間、Code変換の詳細パネルは現在非表示。

CodeからはPlaygroundと同じ出力ハンドルを使える。以下は選択中の音色でC4とG4を1拍ずつ鳴らす。

```js
const out = midi.output('tetorica-fm21290', {channel: CH4});
await out.play('C4', {duration: 1, velocity: 90});
await out.noteOn('G4', {velocity: 80});
await beat(1);
await out.noteOff('G4');
```

この出力のノートはAUTOで割り当てる。CH4は論理MIDIチャンネルで、物理ボイスの指定には従来の `chip.keyOn(CH4, ...)` を使う。

## Keyboard・Code・MIDIを重ねて演奏する

独自コアのAUTOでは同じ音高でも入力ごとに別の物理CHを使う。CodeのStopはCodeの音、Stop MIDIと曲末はMIDIの音だけを離鍵する。MIDIのCC64とCodeの `setSustain` は各入力のノートに作用する。物理CHを明示して再打鍵すると新しい演奏がそのCHを引き継ぎ、以前の演奏から遅れて届いた離鍵を無視する。

OPS / EGSの **Pitch bend (semitones)** は全声に効く±2半音のホイール。ドラッグのほか、フォーカスして矢印キーで微調整、Home / Endで下端・上端まで操作できる。ポインターや操作キーを離すか、フォーカスを外すと中央に戻る。操作中はホイールを優先し、離すとMIDIまたはCodeのパートが最後に指定した有効なベンドへ戻る。外部MIDI出力はノートのみ。

**Mod wheel** は操作した位置に留まる。Positionは0〜127、Rangeは0〜99。Pitch・Amplitude・EG biasを組み合わせて割り当てられる。ビブラートを試すにはPitchを選び、YM21290内のLFOでpitchModSensitivityを上げる。AmplitudeとEG biasは各OPのampModSensitivityに応じて効く。EG biasはホイールを下げたときに減衰が深くなる。

独自コアではMIDIパートのCC1とCodeの `part.modWheel(値)` も同じホイールを操作する。途中再生では直前のCC1を復元し、パートを止めると最後の手動位置に戻る。位置・レンジ・割り当てはCassetteで保存する。単音色・バンクSysExは音色データのみを含む。

独自コアの音色・ピッチベンド・生レジスタは共有で、直接 `0x30f1` に書く操作は指定した物理CHに届く。

## レジスタの記録と再演

OPS / EGSで **Record from reset** を押すと現在の演奏を止め、リセットと選択音色の適用から記録する。その後Keyboard、Code、MIDI、または手動レジスタ書き込みで演奏し、**Finish recording** を押す。**Export trace** でJSONに保存し、**Load trace → Replay** で再演できる。再演開始時にも現在の演奏は止まる。

**Event index** で各書き込みのサンプル位置・番地・値を参照できる。**CH1〜CH16** のボタンを押すと、そのCHのアルゴリズム、FB、ピッチワード、OP1〜6の出力バイトとモデル上のEG段階を演奏中・再演中に確認できる。記録は最大20万イベント。同じサンプルレートを使用する。Master以降の音量は再演時の設定に従う。

## Files

Filesに **Saved locally** と出ると、そのブラウザのIndexedDBへの保存が完了している。次に同じURLを開くと編集中のファイル、現在の音色、プリセット、Modホイール設定、Master、MIDIパートと再生区間・ループ設定が戻る。演奏はRunまたはPlayで開始する。ブラウザの保存領域を使えない場合もMenu → Export → Cassette · ZIPで持ち出せる。

FilesのツリーからJS・JSON・テキストを選ぶと、Code欄にそのファイルが開く。New file pathに `/pieces/lead.js` のように入力するとフォルダも作成される。編集内容はファイルを切り替えても残る。RunとApplyは表示中のJavaScriptを実行する。Cassetteにはプロジェクト内のファイル、空フォルダ、最後に開いたテキストのパスも保存する。以前のCassetteでは `/index.js` が開く。

最初のプロジェクトの `/examples/glass-echo/score.json` で音高とベロシティを編集し、同じフォルダの `play.js` を開いてRunすると変更を聴ける。`await file('./score.json', {type:'json'})` の相対パスは実行中のJSを基準にする。`/song.mid` は読込中のMIDIを返す。読み込んだMIDIは元のファイル名でもツリーに残り、選び直して使える。

Files → presetsから音色ファイルを選ぶと、演奏と編集に使う音色が切り替わる。Glass StepとInitを同梱。単音色SysExをインポートするとpresetsに追加し、32音色のSysExをインポートすると同名のフォルダに1音色ずつ展開する。編集した音色はExport → Voice · SysExで保存できる。Cassette ZIPにはプリセットと現在の編集内容の両方を保存する。旧版のCassetteやローカル保存の32枠はpresets/Recoveredに展開する。他の端末やブラウザに移すにはMenu → Export → Cassette · ZIPを使う。

MIDIはSMF形式0/1・PPQNに対応し、選択したパートを現在の音色で再生する。テンポ、ノート、ベロシティ、サステインを扱う。独自コアのベンド幅は暫定で±2半音。プログラムチェンジは今後の対象。

CodeでMIDIパートを書く場合は、`midi.createPart()` で作成し、`part.noteOn(60, 100)`、`part.noteOff(60)`、`part.sustain(CC64値)`、`part.pitchBend(0〜16383、中央8192)` で演奏する。`part.finish()` で残ったノートを解放する。

## 検証

`node --test docs/synth-fm21290/*.test.mjs`。A4の定常区間の周波数、16声のゲート、32アルゴリズムの出力、時刻付き書き込み列のPCM再現、Cassette往復を検証する。全32アルゴリズムの定常音は `node scripts/compare_fm21290_spectrum.mjs` で同梱MSFAと第8倍音まで比較できる。単一OPのFB 0〜7とAlgorithm 4/6の帰還経路も検査する。実機の帰還量とスロットタイミングは未測定。

MIDIベンドとサステインの比較は `node scripts/compare_fm21290_controls.mjs`。同じA4を両エンジンで演奏し、ベンド後の周波数と離鍵後のRMSを測る。[測定条件と結果](./registers.md#midiベンドとcc64のpcm測定)

新規実装はリポジトリのBSD-3-Clause。アルゴリズム表はGoogle MSFAのApache-2.0ソースから移植した。JS音色変換と比較用WASMも既存アダプタのライセンスを引き継ぐ。[MSFAライセンス](../js/msfa_dx7/LICENSE) · [第三者表記](../js/msfa_dx7/THIRD_PARTY_NOTICES.md)

## itch.io用ビルド

リポジトリのルートで `sh scripts/package_itch_fm21290_synth.sh VERSION` を実行すると、`release/tetorica_fm21290_synth_VERSION_itch.zip` を生成する。itch.ioのHTMLプロジェクトにこのZIPをアップロードする。
