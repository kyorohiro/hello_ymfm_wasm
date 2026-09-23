# NES APU: GB相当のAnalyzer / CLI対応

## 対応範囲

- [x] VGM 1.61以降のNES clock (0x84)、B4レジスタ書き込み、C2 RAM data block。
- [x] 共有Core engineによるBrowser / Node / CLI再生とWAV出力。
- [x] Pulse 1/2、Triangle、Noise、DMCの5チャンネルミュート。
- [x] Pulse / TriangleのNote-ish、MIDI、MusicXML / LilyPond、楽譜チャンネル選択。
- [x] npm・itch配布とJSNESライセンス通知。
- [ ] 実ブラウザでファイル読み込み・再生・Note-ish・Music Sheetの操作確認。

## Architecture

`NesApuAudioEngine` はDOM/WebAudio/fsに依存せず、既存の
`createPlaybackEngine` → `VgmPlayer` → PCMを使用する。CLI用の別音源は作らない。
音源はJSNES APU (Apache-2.0)、commitと変更は `third_party/jsnes/README.md` に記録。
JS実装のため新規WASMやNode factoryは不要。MAMEのGPL NESコードは取り込まない。
DMCはVGM内RAMアップロードを読む。CPU実行・IRQ・DMA待ち時間を追加しない。
ミュートは出力mixに適用し、内部タイマーとサンプル読出しは進める。

## 制約

初回は標準NTSC (1789773 Hz付近) のNES APU。PAL、FDS、dual、拡張音源の
組み合わせは対象外。B4の拡張レジスタはエラーにする。
CPU/ROMエミュレータではなく、VGM/VGZを入力とする。

GB同様、Note-ishと楽譜はレジスタ書き込みからの基音近似。
Noise / DMCは楽譜へ出さない。長さカウンタ・Envelope・Sweep・Triangle linear
counterの時間経過は楽譜には反映しない（再生エンジンはこれらを処理する）。
音色編集、TFI/VGI、MML、NES専用サンプル抽出UIは追加しない。

## 確認方法

リポジトリルートで `python3 -m http.server 38086` を実行し、
http://localhost:38086/docs/vgm_analyzer/ を開く。
`test/fixtures/nes-tone.vgz` はゲーム由来ではない自作A4テスト音。
読み込んで再生、CH1 mute、Note-ish、Sheet Music、MIDI出力を確認する。

```sh
npm test
npm run test:analyzer
npm run build
node dist/cli/main.js analyze test/fixtures/nes-tone.vgz --json
node dist/cli/main.js render test/fixtures/nes-tone.vgz --output /tmp/nes-tone.wav
node dist/cli/main.js export test/fixtures/nes-tone.vgz --format musicxml --output /tmp/nes-tone.musicxml
```

新機能はローカル変更。npm公開済み0.1.0へはまだ反映しない。

## 検証結果

- Node.js 25: CLI 63件成功（NESを含む実tarballのオフラインインストール・Node/CLI WAV一致）。
- Analyzer 586件成功、失敗0、任意テスト1件skip。
- 共有Browser engine/NodeのPCM一致、DMC RAM差分、5ch出力・mute、区間・reset、楽譜選択を検証。
- Browser UI関数の5ch muteとGB/NES Note-ish reset・ラベルをテスト。
- buildは118依存ファイルをstage。itch用nes-check ZIP生成成功。
- 実ブラウザの接続が利用できなかったため、実画面の操作・音の聴取は未実施。Node.js 22での確認も未実施。

## FDS 追加

FDS フラグ、再生・CH6 ミュート・基音 Note-ish / export を追加。
fixNES の派生実装と許諾文は `third_party/fixnes-fds` に保存。
`test/fixtures/fds-tone.vgz` で試せる。上記の初回制約の FDS 除外は解除。
変調・時間経過によるエンベロープは楽譜に転記しない。実曲の試聴は未確認。
