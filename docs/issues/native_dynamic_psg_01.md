# Native追加Sega PSG

2026-10-23。Native版の`createSoundChip()`を、独立したSega PSGから対応する。
固定Modeの主音源と同じチップを取得する`useSoundChip()`と、追加生成を区別する。

```js
const lead = await createSoundChip('segapsg', {id: 'lead'});
const bass = await createSoundChip('segapsg', {id: 'bass'});
await mixer.set(lead.id, {volume: 0.5, pan: -0.4});
await mixer.set(bass.id, {volume: 0.5, pan: 0.4});
lead.tone(0, {note: 'C4', attenuation: 7});
bass.tone(0, {note: 'C3', attenuation: 9});
// lead.off(0); bass.off(0);
// lead.dispose(); bass.dispose();
```

## 接続

- 全Native Modeから追加できる。最初の対象は`segapsg`のみで、他の追加音源はWeb Audioを使う。
- 最大16インスタンス。準備中・破棄待ちも数える。固定ModeのPSGはこの上限に含めない。
- Game Gear用の単独C++ PSGコアを再利用し、FMやOPLLの不要な複製を避ける。
- tone／noise、ステレオ、クロック、音量・pan・mute・solo、状態の読取りを扱う。
- ユーザー用ミキサーIDとNativeのインスタンス番号を分ける。
  同じIDで作り直しても、前のインスタンスへの予約・破棄は新しい音源へ届かない。
- MainとWorkerは同じNative命令キューへ接続する。Workerの追加音源も既存の
  performance・owner管理を共有し、別の演奏タイムラインを開始しない。
- Mixerの追加・削除は音源のライフサイクル通知として扱う。
  単なる接続によって`mixer/current.json`を上書きしない。

## 音声側の制約

生成とメモリー確保は制御側で行い、callbackへ準備済みのコアを渡す。
callbackは固定上限のスロットを処理し、破棄するコアの最後の参照を制御側で回収する。
コアの生成・破棄のためにcallbackをロックしない。

Stop／再Run／Mode変更では追加音源を片付ける。
個別のdisposeはそのインスタンスだけを無効化し、先に送られた未来の命令にも適用する。
`useSoundChip('segapsg')`で借用する主音源の寿命は変更しない。

## 検証

物理音声デバイスを開かず、C++／Rustのオフライン描画と、Native IPCを模擬した
Main・実Worker・Chromium／WebKitで確認する。

- C++の66ケース・436,224 stereo framesで、既存WASMとPCMが完全一致。
  複数コアのクロック・latch・ステレオ・mute・破棄の独立性を確認し、
  fixtureの描画中はC++のallocation／freeとも0。
- Rustの追加11件で、22モード、出力とMixer、容量制限、無効な命令、
  破棄後の未来予約、所有者のキャンセル、生成前後のStop、制御側での最終回収を確認。
  状態取得の待機中にも、破棄・Stopが進むことを確認。
- JSの追加7件で、Main／実Worker、同じIDでの再生成、生成途中のStop、
  非PSGモードの`useSoundChip()`キャッシュ、liveLoopの片方だけのキャンセルを確認。
  音源の接続・破棄だけではMixerの保存値が変わらない。
- JS全体4,201件成功、既存1件skip。
- Cargo全体316件成功、既存4件ignore。ローカル通信を使う既存テストは
  sandbox外で確認し、音声デバイスを使うテストは実行していない。
- Tauri取り込み後のChromium／WebKitでも、Main／Worker、Mixer、Inspector、
  PC Keyboard、Stop／再Run、個別破棄・同じIDの再利用が成功。
  AudioContext／OfflineAudioContext／AudioWorkletの生成は0。
- 同じ配布版でMixerのPreset切替・保存・新規Cassetteへのdefault継承・
  IndexedDB再読込み・ZIP入出力も両ブラウザーで成功。

```sh
node --test web/native_genesis_extra_segapsg.test.mjs
node scripts/check_playground_native_backend_browser.cjs --extra-psg-only
cargo test --locked --manifest-path w/tetorica-fm2612-playground-tauri/src-tauri/Cargo.toml extra_psg
```

フロントエンドZIPは848ファイル、SHA-256
`77314d83243cd6d92da225c8e9e57fc082264d2c0a6774302ed1d4cd009b8742`。
同梱NativeソースZIPは1,309ファイル、SHA-256
`6e96bb7b489bb68899601ad64e02d70ad9615243858cf5e356292180daca004d`。
原典21種類・checkout・ZIP内manifestとの照合も成功した。
