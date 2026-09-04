# Neo Geo YM2610 / YM2610B Playground メモ

## 目的

Tetorica を OPN family の Playground / Runtime として育てる。
Neo Geo 向けには YM2610 を扱い、最初は FM-only を追加する。SSG と ADPCM は
FM API と混ぜず、chip 固有の高級 API として後から追加する。

## YM2610B core と Neo Geo profile

内部 emulation core は YM2610B を使用する。YM2610B は YM2610 の機能を含み、FM を
6 channel 持つ。一方、Neo Geo 実機の YM2610 profile は FM 4 channel として公開する。

```text
YM2610BRuntimeSynth       // YM2610B の完全な emulation core。FM 6ch。
NeoGeoSynth               // YM2610B core を所有する Neo Geo profile。FM 4ch を公開。
```

- Neo Geo Playground では `CH1` から `CH4` だけを公開する。
- `CH5` / `CH6` は YM2610B 固有であり、Neo Geo 実機 profile では補完、Operator UI、
  高級 API に出さない。
- raw register write は低レベル検証と VGM 用に残すが、Neo Geo profile が許可しない
  FM channel を通常 API から使わせない。
- 将来、YM2610B 実機向けの6ch profile が必要になった時だけ別 profile として公開する。

YM2610 の4 FM channel は register 上で連続した4 channelではない。`NeoGeoSynth` は
論理 `CH1` から `CH4` を YM2610 の実際の FM channel/register へ明示的にマップする。
単に `channelCount: 4` を指定するだけでは正しくない。

## FM-only TODO

### 1. WASM core

- `wasm/ym2610b_wasm.cpp` を追加する。
- `web/ym2610b.js` を追加する。
- `scripts/build_ym2610b_wasm.sh` を追加する。
- create/reset/write/sampleRate/generate の smoke test を追加する。

### 2. Browser audio

- `web/ym2610baudioengine.js` を追加する。
- `web/ym2610b-worklet.js` を追加する。
- FM-only の PCM fixture と AudioWorklet 起動確認を追加する。

### 3. Synth / Neo Geo profile

- `web/ym2610bsynth.js` を追加し、YM2610B の FM 6ch API を実装する。
- `NeoGeoSynth` を追加し、`TetoricaAudioRuntime` へ接続する。
- Neo Geo の論理 FM 4ch を実際の YM2610 register channel へマップする。
- Neo Geo profile では `CH5` / `CH6` を UI、補完、高級 API から隠すテストを追加する。

### 4. VGM

- `web/ym2610bvgm.js` を追加する。
- 既存 VGM parser に YM2610 command を追加する。
- FM-only native export、timing、FNUM のテストを追加する。
- 初期版では SSG、ADPCM-A、ADPCM-B の VGM register を除外または注記する。

### 5. Playground

- `createTetoricaSynth({ chip: "ym2610" })` を Neo Geo FM-only profile として公開する。
- `?chip=ym2610`、4 channel Operator UI、Worker capability、Monaco `.d.ts` を追加する。
- VGM import UI、トップページの導線、browser 動作確認を追加する。

## 将来の chip 固有 API

FM-only を確認した後、Neo Geo profile に次を追加する。

```js
pg.ssg.setTone(...);
pg.ssg.setEnvelope(...);

pg.adpcmA.load(...);
pg.adpcmA.play(...);

pg.adpcmB.load(...);
pg.adpcmB.play(...);
```

- SSG は Mega Drive の `psg` と別 API にする。
- ADPCM-A と ADPCM-B は ROM/sample bank の lifecycle、loop、volume、pan を chip 固有に扱う。
- ROM transfer と Worklet message protocol は `TetoricaAudioRuntime` ではなく
  `NeoGeoSynth` / YM2610B の担当にする。

## 優先順位

1. YM2612 をゲーム組み込みまで完成させる。
2. YM2203/YM2608 FM-only の browser 動作確認と Playground 整理を終える。
3. YM2610B core と Neo Geo FM-only profile を追加する。
4. SSG、ADPCM-A、ADPCM-B を段階的に追加する。

X68000 の YM2151 は OPM family であり、この OPN Playground の対象外とする。
