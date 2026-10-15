# Playground examples

FILES の `examples/` を開き、フォルダー内の `.js` を選択して Run を押す。
ファイルを選ぶとエディターと Run file の両方が切り替わる。
サンプルはプロジェクト内で編集でき、Cassette Export にも保存される。

| Folder | 内容 |
| --- | --- |
| basic | グローバル fm・psg・dac と、liveLoop・context・FX・MIDI・noise・samples |
| chip-raw | 音源レジスタを直接操作する例 |
| genesis | 独立 Sega PSG・Mega CD PCM（RF5C164） |
| gameboy | pulse・wave・noise・複数音源の設定 |
| nes | NES APU の pulse・triangle・noise、FDS 波形と変調、DMC サンプル |
| pc98 | 独立 YM2608 の SSG・rhythm・ADPCM-B（PCM からの loadSample を含む） |
| x68000 | 独立 YM2151 の FM |
| dx7 | MSFA DX7 の16音発音、MIDIノート番号と SysEx 音色の読み込み |

FILES ではこの順に表示します。機種別のサンプルは各フォルダーに直接置きます。`basic/` 内の共通機能サンプルは機能別に分類しています。
`chip-raw` は直接レジスタを書く入口として残しています。
`basic/fm`・`basic/psg`・`basic/dac` は選択中の音源や Playground のグローバル API を使います。
機種別フォルダーには `useSoundChip()` / `createSoundChip()` で独立した音源を取得する例を置きます。

`basic/fm/soundchip-tone-controls.js` は共通の音程・発音操作の例です。
`setFrequency(ch, hz)`、`setNote(ch, note)`、`keyOn(ch)`、`keyOff(ch)`、`noteOn(ch, note)` を使います。
音名やMIDI番号を渡すnoteOnと、Hzを渡すsetFrequencyは別の入口です。

`nes/nes-pulse-frequency.js` は Hz 指定の例です。`nes.pulse.setFrequency(0, 440)`
で周波数を設定し、`keyOn(0)` / `keyOff(0)` でその音程の発音・停止を行います。
`noteOn(0, 'A4')` は音名または MIDI ノート番号を指定して発音する別の入口です。

`dx7/dx7-init-sine.js` は、独立した16音の DX7 音源を使います。
`dx7.noteOn(60, 100)` は MIDI C4、velocity 100 です。チャンネル引数はありません。
初期音色は自作の `INIT SINE` なので、そのまま Run で演奏できます。
自分の `.syx` ファイルを FILES に読み込んだ場合は、次のようにバイナリーとして渡します。

```javascript
const dx7 = await useSoundChip('dx7');
await dx7.loadSysex(await file('/presets/my-bank.syx', {type:'arrayBuffer'}));
console.log(dx7.voices); // {index, name} の一覧
dx7.selectVoice(0);
dx7.noteOn(60, 100);
await beat(1);
dx7.noteOff(60);
```

`loadSysex()` の完了は音色が Worklet に適用された通知です。発音前に必ず `await` してください。
DX7 1 Voice / 32 Voice Bank の完全な SysEx に対応し、不正なデータでは既存音色を保持します。
`useSoundChip('dx7')` は同じ音源を再利用し、`createSoundChip('dx7', {id:'pad'})` は独立音源を作ります。
音量・mixer・FX に接続され、STOP で破棄されます。Main / Worker の両方で使えます。
`allNotesOff()` はリリース、`panic()` は即時消音です。同じノートの Note Off は同音の全声をリリースします。
上流の16音割り当てを保ち、16声を保持中の追加発音は無視します。独自のボイススティーリングはありません。
内部は44,100 Hz固定、出力は AudioContext の44,100 / 48,000 Hzに対応します。
48,000 Hzは出力側で線形補間します。`setClock` やサンプル精度の予約APIはありません。
msfa の AM・transpose 等の制約は [DX7 ライブラリの README](../../js/msfa_dx7/README.md) を参照してください。
外部の音色バンクは同梱していません。

`?ex=...` は廃止。`?src=...` によるコード共有は引き続き利用できる。
各サンプルの利用可能な音源・機能はコード内の API に依存する（DAC/PSG 等は YM2612 モード）。

## サンプルを追加・修正する場合

このフォルダーの JavaScript が原本。サンプル名（拡張子を除くファイル名）は重複させない。

```sh
node scripts/build_playground_examples.mjs
node scripts/build_playground_examples.mjs --check
```

生成された `playground_examples.js` は、コードを実行せず文字列として配布するためのバンドル。
直接編集しない。itch.io パッケージ生成時にも更新する。
