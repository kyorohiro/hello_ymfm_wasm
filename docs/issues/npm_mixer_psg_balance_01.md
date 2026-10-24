# tetorica-fm2612 0.2.27: calibratedプリセットのPSG系音量

2026-10-24。Analyzerで採用した[PSG系の再調整](analyzer_psg_levels_01.md)を、
npmの`SOUNDCHIP_MIXER_PRESETS.calibrated`にも反映する。
NESはAnalyzerのJS版から値をコピーせず、公開factoryのWASM版を別途測定した。

## 適用値と範囲

| 種類 | 0.2.26のcalibrated | 0.2.27のcalibrated | 以前に対する比率 |
| --- | ---: | ---: | ---: |
| `segapsg` | 0.644089 | 0.455420 | 約70.7% |
| `ay8910` | 1.545813 | 1.100331 | 約71.2% |
| `nes`（WASM） | 2.000000 | 1.514209 | 約75.7% |

22種類のうち上記3種類のfallback volumeだけを変更する。
残り19種類、追加Nukedのengine値、OPN内部のFM／SSG／rhythm／ADPCM比率は維持する。
`new SoundChipMixer()`と`mixer`省略時の従来値、生PCM、保存済み明示設定の優先順位は変えない。
新しい倍率を別段に重ねる処理や、演奏中の正規化は導入しない。

```js
import {SoundChipMixer, SOUNDCHIP_MIXER_PRESETS} from 'tetorica-fm2612';
const mixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
```

AnalyzerのNES初期値`1.512236`はJS版の測定値として維持する。
Playgroundの機種別Systemプリセットは別設定で、この変更では更新しない。
共有PCMChipMixerの借用Viewについては、有効frame数だけを処理する修正も0.2.27へ同梱する。

## 測定と生成

[測定JSON](soundchip_psg_levels_01.json)は、公開`createSoundChip()`から作った実WASMの
44,100／48,000 Hz・220／440／880 Hz、計18条件を記録する。
各音源は1 CH・最大固定level、NESは50% dutyのpulse、AYは以前と同じtype0／flags1。
0.25秒warmup後の1秒を測り、DCを除いたAC RMSを比較する。

共通基準は倍率`1.033570`を維持したYM2608 FMのAC RMS
`0.09108396077488734`。44,100 Hz・440 Hzから倍率を算出し、他の周波数・rateは平坦化しない。
48,000 Hzで同じ倍率を使った差は最大約0.0601%。
波形・音色・発音数による聴感の差は維持する。

生成器は従来の完全なPlaygroundピーク測定を検査してから、PSG用の別測定で3種類だけを置換する。
canonical周波数、WASM backend、FM基準、算式、低減方向、source hashを検査し、
Analyzer JSのNES測定を誤って流用したreportは受理しない。

```sh
node scripts/measure_soundchip_psg_levels.mjs --out docs/issues/soundchip_psg_levels_01.json
node scripts/generate_soundchip_mixer_presets.mjs
node scripts/generate_soundchip_mixer_presets.mjs --check
```

## 検証と配布物

- 関連自動試験64件成功。その他の音源値、明示設定、旧raw PCM、生成器の不正入力拒否を確認。
- 実Workletの6音源をChromium／WebKitで確認。新初期値、出力倍率とAC RMS、
  明示0.5、Mixer省略時の従来値、解放後の経路消去、生PCM一致が成功。
- 隔離tarballの全942ローカル参照、15 renderer、26 WASM pairs、NodeNext／Bundler／
  Browser型利用、録音sample／Native接続関連の既存試験が成功。
- ビルド時に328 JSDoc宣言を生成・検査した。
- Analyzerの実音源8経路も再確認し、最終初期値・WAV出力が維持されることを確認した。
- 最終tarball内803 filesがstageとbyte一致し、再packのdry-run integrityも一致した。

最終配布物：`tetorica-fm2612-0.2.27.tgz`、1,579,187 bytes。

- SHA256：`440c44b4083c6cf77568918629591447391015abcdb2d2faf18fc05511d4fc90`
- npm shasum：`58c73204e7468563cb92d677513eac6cc6d14991`
- npm integrity：`sha512-y8+1xkPyL7hC9XZ/uXlntV+Sfl5Gd4mvEz1vg9JXyyWu+M5jRrCw1nhbgsSstzv9kw6qaJSZyF+o72HqCMbSRg==`

ブラウザー認証後、`npm publish`はexit 0、`+ tetorica-fm2612@0.2.27`を返した。
registryの`latest=0.2.27`、integrityの一致、公開tarballを再取得してのbyte一致を確認した。

[npm: tetorica-fm2612 0.2.27](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.27)
