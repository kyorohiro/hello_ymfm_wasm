# 8580 cutoff: LP／HP交点による独立測定（2026-11-07）

目的は、前段階で残った中心周波数の差をresonanceや全体gainへ吸収せずに測ること。既存6581製品・Player／SDKと過去の結果を保持する。これは固定エミュレーターを使う独立研究の方法であり、実機cutoffの測定・本番8580採用を宣言するものではない。

## 何を測るか

同じcore、同じFC／RES、同じ発音・level・sample tickでLPとHPを別captureし、**同じ実周波数・同じharmonicの振幅**を比較する。理想的な二次state-variable filterでは、共通分母を`D(s)=s²+(ω0/Q)s+ω0²`として、`LP=ω0²/D(s)`、`HP=s²/D(s)`となる。したがって

`|LP(f)|/|HP(f)|=(f0/f)²`

であり、`20log10(|LP|/|HP|)=0`の周波数を交点として求める。この理想モデルではQが分母ごと消え、同じ周波数の共通gain／下流RCも比から消える。式の根拠は[TIの可変Q LP／HP伝達関数](https://www.ti.com/document-viewer/lit/html/SLAAEH6/GUID-89D88A71-BAEC-43CC-B41D-E8983549BEC3)。ここからの比はその代数的導出で、SID内部の私的実装式を利用しない。

結果名は**operational LP=HP crossover**とする。任意QでのLPの−3dB点、BP peak、内部frequency DACの物理poleと同一視しない。[8580の一次回路解析](https://github.com/libsidplayfp/SID_schematics/wiki/8580-Filter-overview)はrouting／mode・積分段の確認に使うが、理想式への完全一致は仮定しない。

mode固有gain／loading、非線形・飽和・動作点、noise／量子化、harmonic混合・aliasingがあれば厳密な相殺は崩れる。[外部filterの回路解析](https://github.com/libsidplayfp/SID_schematics/wiki/External-Filter)が区別するmotherboard RC／接続負荷も、両captureで同じ伝達系である場合に限って共通因子として扱える。RES・level・rateを変えるholdoutで、この方法自体の安定性も確認する。

## capture条件と有効性

- 前の[controlled quality手順](sid8580_quality_method_01.md)を使う。全voiceのTEST／Gate／ADSRから両engine自身のOSC3／ENV3を確認し、同じ発音時刻とsettlingを使う。片側のreadを他方へ注入せず、非公開state／filter係数を直接取得しない。
- 候補と公開APIの外部oracleをchip cycleごとに進め、共通整数samplerのphaseをskip中も維持する。Hann重み付きDC＋harmonic fitには実sample tickを渡す。元PCMのgain／DC／phase補正はしない。
- 各LP／HP pairで整数frequency register・harmonic番号・sustain・master volume・routing・窓を揃える。基本波の上限約3,848.6Hzを超える測定にはSAW等の明示した高調波を使い、実周波数・次数・Nyquist guardを記録する。LPの3次とHPの基本波を比べない。
- 今回の全caseでoutput volumeを12へ事前固定した。これは高harmonicのPCM量子化を減らすための後段出力levelで、filterへの入力levelを変えるsustainとは別。前段階のfixtureや測定をvolume12へ書き換えない。
- 振幅・clip・settling／窓安定性を検査する。最小振幅8LSB、最低3周波数点、単調性の許容差0.5dB等は測定側の閾値で、hardware仕様ではない。採用した最終閾値とsource hashを結果へ残す。
- `LP/HP`のdB値が正から負へ移る隣接した有効点をlog周波数上で補間する。弱いtailを除外した場合は一覧へ記録するが、交点bracket内の無効点を飛び越えて補間しない。周波数重複、逆向きの交点（HP優勢→LP優勢）、複数交点、強い非単調性、範囲外交点、有効点不足はnullと理由を返す。
- Q不変・共通RC／gain不変の理想解析解、振幅境界・欠損・重複・曖昧な交点を新metricsの独立テストで確認する。数学テスト成功と実SID品質は分けて記録する。

## trainingとholdoutの計画

| 区分 | FC | 固定／変更する条件 |
| --- | --- | --- |
| training | 64, 128, 256, 512, 1024, 1536, 2047 | 8580、PAL985248Hz、48kHz、sustain4、RES0。既存opt-inは明示して固定 |
| 未使用FCのbase holdout | 96, 192, 384, 768, 1280, 1792 | 48kHz、sustain4、RES0。trainingへ使用しない |
| 未使用FCでのinteraction holdout | 192, 1280 | 各44.1／96kHz、sustain15、RES12。全6FCで他level／rateを測るmatrixではない |

確定fixtureはtraining189case、holdout270case（base6＋interaction4曲線、各9点のLP／HPとdry）を生成する。gridは`(6.2*FC+30)*factor`、factorは0.6／0.72／0.84／0.96／1.08／1.2／1.32／1.44／1.6。これは周波数探索範囲であり、参照にfit済みのcutoff式ではない。harmonicは`ceil(requestedHz/3000)`を選び、LP／HPはその同じ次数・実registerで組にする。実際に交点をbracketできなければ外挿で埋めない。点を追加する場合もtrainingとholdoutの区分を失わない。

FC0は今回測定していない。profileを作っても元の30Hz係数を残すanchorであり、そのendpointのhardware精度を主張しない。

profileを作る場合はtrainingだけから係数を決め、holdoutを見る前に固定する。cutoff／resonanceのflagを区別し、まずcutoff単独の効果を測り、両方Onの確認をする場合も別条件として記録する。holdoutの結果で同じ係数を再調整した測定を、独立評価と呼ばない。

保存するのはsource／binary／fixture／metrics／profileのhash、全register条件、read・sample範囲、元振幅、交点bracket／補間値／無効理由、fit・holdout分類と改善・悪化点。自作signalだけを使い、音楽／ROMやGPL参照実装を候補へ混ぜない。default・6581・旧profile・bus／実CPU・元APIの回帰、matching source／CI／可読kitは別の完了条件とする。実曲、full C64、AudioWorklet、実聴と本番UI／parserへの採用は後続のまま。
