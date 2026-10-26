# DX7初期コードの音量とMixer設定

日付: 2026-10-26

## 原因

DX7の初期コードは`await mixer.set(dx7.id, {volume: 0.5})`で、選択済みMixer設定をRunごとに上書きしていた。
SystemのDX7初期値は`1.038825`。この`0.5`はSystem倍率に追加で掛ける値ではなく、絶対値の置換だった。
Web／Nativeの主音源・追加音源の接続を調べた範囲で、DX7専用の隠れた半減処理やMixerの二重適用は見つからなかった。

さらに、初期音色`MODE KEYS`はOP1の`outputLevel: 85`とEG levels `[99, 85, 75, 0]`を使っていた。
Systemの校正は単一キャリアのoutputLevel99／EG99を基準にしているため、MixerだけSystemへ戻しても音色側の減衰が残る。
MixerのPreset変更は音色を変更しない。

## 変更

- DX7 modeの`index.js`からMixer指定を削除した。他modeの初期コードにはMixer操作がないことも確認した。
- DX7の4つの基本Exampleからも同じ`volume: 0.5`指定を削除し、選択したMixer設定を保持する。
- ユーザーの選択に従い、`MODE KEYS`のOP1を99、EG levelsを`[99, 99, 99, 0]`へ揃えた。
  保持中のレベルを維持し、離鍵時にreleaseする。発音中のoperatorは従来どおり1個。
- 旧DX7初期コードの全文をstarter historyへ保存し、生成Example bundleを更新した。

System倍率`1.038825`、ライブラリーの`INIT SINE`、インポートするSysEx音色、WASM／Native coreは変更していない。
既存の保存済みコード・Mixerのcurrent／default／名前付きPresetも自動では変更しない。
旧コードを実行して保存された`0.5`は、MixerでSystem等を選び直すか手動編集するまで保持される。
新しい初期コードはNew Cassetteやmode変更時の初期コード選択で利用できる。

## 確認

実配布WASMと公開DX7 APIを使い、44.1／48 kHzでC4・velocity100の50～200 msを測定した。
次の値は44.1 kHzのmono PCM RMS。Mixer後の欄は同じPCMへ倍率を掛けた計算値で、実機の聴感測定ではない。

| 初期音色 | core PCM RMS | System `1.038825`適用後 |
| --- | ---: | ---: |
| 旧MODE KEYS：OP85／EG85・75 | 0.003279 | 0.003407 |
| 新MODE KEYS：OP99／EG99 | 0.088250 | 0.091677 |

旧コードのMixer `0.5`適用後はRMS `0.001640`だった。
48 kHzでも新初期音色は同じ単一キャリア基準と一致した。

既存のExample実行・starter history／保存データ保護のNode試験34件と、生成bundle照合が成功した。
Chromium／WebKit × Main／Workerの4ケースで、実WorkletのPCM、Systemの維持、
任意の`volume: 0.73, pan: -0.2`のRun／Example後の維持、Systemへの復帰を確認した。
最終音色では再生中RMSが`0.06`を超え、非有限値・clipがないことを確認した。
最初のdestination接続前からzero Gainを設けており、物理出力の聴音はしていない。

Browser試験はsandbox内のlocalhost bindがEPERMになったため、同じharnessを許可された環境で実行した。
接続処理や製品コードをその失敗に合わせて変更していない。

証跡は`/private/tmp/tetorica-dx7-mixer01/`、測定用scriptは`/private/tmp/measure-dx7-starter-levels.mjs`。
commit／公開、Tauriの配布物取り込みは実施していない。
