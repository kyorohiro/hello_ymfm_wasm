# WonderSwan Playground Mode

2026-10-27。単体C++／WASMに続き、PlaygroundのWonderSwan Modeを接続した。
BrowserとTauriの **Web Audio** で動作する。Tauri Native Audio backendへの接続は今回含まない。

## 利用できるもの

- Mode `wonderswan`：3,072,000 Hz、4CH、初期コードと3つのExample。暗黙のFM音源や`play()`は作成しない。
- 主音源の`ws`と`useSoundChip('wonderswan')`。別インスタンスは`createSoundChip('wonderswan', {id: '...'})`で作成できる。
- 32点／4bit波形、音程・左右音量・gate、CH3 Sweep、CH4 Noise、CH2 Voice PCMレジスターのAPI。
- Main／Worker実行、コード補完・型、chip／物理CHを指定するKeyboard、独立したMixer strip。
- WonderSwanタブ：波形の描画・数値編集・定型波形、左右音量・音程、Noise／Sweep／Voiceの操作、Hold／Preview／Keyboard、コードの書き出し。

```js
ws.setWaveform(0, Array.from({length: 32}, (_, i) => i < 16 ? 15 : 0));
ws.setVolume(0, 9, 9);
ws.noteOn(0, 'A4');
await beat(1);
ws.keyOff(0);
```

CHはAPI上で`0..3`。CH2をVoice PCMにした場合は、音程付きのKeyboard試聴を無効にする。
PCMバイトを時間指定で書き込む経路であり、サンプルの自動pitch変換やDMAは用意していない。

## 音声・状態の扱い

音声はAudioWorkletの実WASMで生成する。画面からの明示的な編集だけが命令を送り、音声生成から画面を直接変更しない。
UI編集完了時にauthoring状態を通知し、描画のためのレジスター書き戻しやrenderごとのRAM転送は行わない。

4CHで共有する`0x90`は、通常のgate／mode操作に変更対象maskを付けて音声側でmergeする。
Main／Workerの古いshadow値が、別CHや手動試聴を止めることを防ぐ。生の`writeRegister()`は全byte書き込みの意味を維持する。
手動試聴と演奏の予約を分け、clock変更予約中の新規試聴は拒否する。
Stopは演奏・試聴・held出力を確実に消音し、波形・音色設定・clockを残す。

`allNotesOff()`はCH別の解除に分け、ループ内では他のループが所有するCHを残す。
Mainの主音源・追加音源にもCH別の所有を記録し、ループの終了でそのCHだけを解除する。
終了済みループの遅れた`finally`から、共有音源を`reset()`・再編集する操作も抑止した。
修正前のChromiumでは、CH0／CH1を2ループで鳴らし片方が`allNotesOff()`すると両方が止まることを再現した。
同じ回帰試験が、修正後のMain／Worker・主音源／追加音源で通過した。

raw C++／WASMは変更せず、MAME準拠のunipolar PCMを維持する。
Playgroundのスピーカー出力で、波形平均と左右音量に由来するDC成分を補正する。
これは音量の正規化ではなく、raw出力と公開低レベルAPIには適用しない。

補正は、コアが各CHの最初の波形サンプルを出すnative tickから始める。
先行して平均値を引く旧方針を実WASM上で再現すると、初期コードの先頭32フレームに余分な負方向パルスが出た。
修正で最大段差は`0.294189453125 → 0.0390625`となり、定数8の波形は44.1／48kHzとも起動時peak 0。
raw PCMの差は0で、定常区間は従来の平均値減算とサンプル単位で一致する。
音符本来のhard key-offや任意波形の段差にfadeを加えるものではない。

Mixerの新規初期値は明示的な **1.0**。WonderSwanはまだ共通の音量校正を行っていないため、
policyの`unmeasuredKinds`に記録し、既存の測定済み音源・倍率・校正inventoryは変更しない。

## 検証

- 実WASMの高級API、RAM／レジスター、Main／Workerの共有gate、手動試聴、clock予約・取消、Stop、state handoff、初期化中close、processor異常からの再起動を確認。
- Modeの型／補完で`ws`と4CHの境界を確認。WonderSwan Modeへ暗黙の`fm`／`play`／`CH1`が混入しない。
- Chromium／WebKitで初期コード・3 Example・Keyboard・波形／stereo／noise／sweep編集を確認。
- 同じ実ブラウザーで、Genesis Modeへ追加生成したWonderSwanの独立Mixer／Inspector、Main／Worker演奏とStopを確認。
- A4は約440.37 Hz。基準clockにおける11bit周波数レジスターの丸めに対応し、左右同一設定のPCMも一致した。
- 取得PCMは音声デバイスへの最終出力をmuteして検査した。実機の音色精度や聴感上の無ノイズを保証する試験ではない。
- 全Modeの型検証、npm配布物の生成・インストール・実行・型検証、flat itch ZIPの実ブラウザー検証を実施した。公開はしていない。

最終の関連Node試験は437件成功。TauriのPython 22件／Node 31件も成功し、
Frontend 918ファイル・固定SDK 0.1.2の381ファイル・Nativeの22固定記録と対応ソースZIPを照合した。
NativeのDSP／Rustは変更していないため、今回新たなCargo全体ビルドやインストーラーの起動は行っていない。

実ブラウザーの結果は[JSON記録](playground_wonderswan_mode_01.json)に保存する。
コア単体の一致検証・制限は[wonderswan_core_01.md](wonderswan_core_01.md)を参照。

## 配布物と取り込み

- itch用ZIP：`release/hello_ymfm_wasm_wonderswan-dev_itch_playground.zip`
- SHA256：`1bb95a493cbb645a05e9670199cceaaeff1f7d380d9a608e30771cd579000905`
- Tauri frontend：同じZIPから918ファイルを取り込み、`import_release.py --check`成功。
- 対応ソースZIP：1,837ファイル、SHA256 `97720e903b951fa4622bbbda24819c2ced982f961146162fc21e1e048c8059c5`。
- Browser cache revision：`wonderswan-mode-2`。共有依存にも伝播するが、既存音源のDSPや音量は変更しない。

## 再実行

```sh
node --test web/wonderswansynth.test.mjs web/playground_wonderswan.test.mjs web/playground_wonderswan_audio.test.mjs web/playground_wonderswan_inspector.test.mjs web/playground_wonderswan_performance.test.mjs web/playground_wonderswan_speaker.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_wonderswan_browser.cjs
npm run build:fm2612
node scripts/check_fm2612_package.mjs --skip-build
sh scripts/package_itch_playground.sh wonderswan-dev
node scripts/check_playground_wonderswan_browser.cjs --docs-dir release/itch_playground_wonderswan-dev
```

## 次の作業

検証済みのWonderSwan原本を`tetorica-soundchip-native`へ集約し、新SDK版の正式な固定取り込みを経て、
Tauri Native backendへ接続する。現行固定SDK 0.1.2と既存27 artifactのビルド元は変更していない。
CPU／BIOS／ROM／Hyper Voice／sound DMA／VGM再生／save stateは未対応。
npm／SDK／itch.ioの公開、commit・tag作成は行っていない。
