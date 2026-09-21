# VGM Score Channel Groups

## 目的・今回の範囲

ラウンドロビンで物理CHへ分散した音を、手動で1つのGroupへまとめて表示・楽譜出力する。
「全CHをまとめる」と「任意の非連続CHをまとめる」を用意する。
音色解析、メロディ推定、自動分類は行わない。Groupが元の楽器・パートに一致するとは限らない。
Player / Parser / 音源の処理は変更しない。

## 実装

- [x] 共通 `score_groups.js`。chip名を含む既存の安定CH IDで指定する。
- [x] Group名、任意CH選択、保存・編集・削除、Merge all channels、Clear groups。
- [x] 同じCHを複数Groupへ入れる指定・存在しないCHをエラーにする。
- [x] 未所属CHは個別のまま残す。元データを変更せず、音符に元CHとkeyを保持する。
- [x] Note-ishのSong表示へ反映。Liveの物理CH表示と再生は維持する。
- [x] MusicXML / LilyPondではGroupごとに1つのPart / Staffを出力する。
- [x] 重なった音は機械的に別voiceへ割り当てる。後続音で先行音を切らない。
- [x] CLI / Node APIから同じ共通処理を利用する。
- [x] 重なり・元CH情報・不正指定・CLI出力・既存動作を自動テストする。

## Browserで試す

1. 曲を読み込み、Note-ishまたは楽譜の設定から **Channel Groups…** を開く。
2. **Merge all channels**、または任意のCHをチェックして名前を入力し **Save selected group**。
3. Note-ishは **Song** を見る。楽譜は設定を閉じて再生成する。
4. **Edit / Remove / Clear groups** で変更・解除できる。

設定は読み込んだ曲のセッション内だけで保持する。別ファイルの読み込み・再読み込みへは引き継がない。
楽譜のInclude channelsでは、Group内のどれか1つを選ぶとGroup全体を含める。

## CLI / Node API

```sh
# まず物理CH IDを調べる
npx tetorica-vgm score-channels song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --merge-all --output all.musicxml
npx tetorica-vgm export song.vgz --format musicxml --group 'Piano=ymf262-ch1,ymf262-ch5,ymf262-ch9' --output piano.musicxml
```

`--group`は複数回指定できる。`--merge-all`と併用できない。
`--channels`を併用するCLIでは先に物理CHを絞るため、Groupの全メンバーを選択に含める。
`--merge-all`はその選択済みCHをまとめる。MusicXML / LilyPond専用で、MIDI・再生ミュートへは影響しない。

```js
exportSource(source, {
  format: 'musicxml',
  groups: [{id: 'piano', name: 'Piano', channels: ['ymf262-ch1', 'ymf262-ch5']}],
});
```

## 制約

既存の16分音符グリッド・未知音高の休符化・短すぎる音の省略は引き継ぐ。
声部分けは音の重なりを保存するためで、音楽的なパート解析ではない。
大量の同時発音を1つにまとめると、多数のvoiceで楽譜が密になることがある。
元CHはMusicXMLの非表示notation、LilyPondのコメントに残す。
自動テストとは別に、実曲での譜面の見やすさは使いながら確認する。
