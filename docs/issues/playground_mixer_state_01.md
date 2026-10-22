# Mixerの共通初期値・プロジェクト保存と音源の後始末

2026-10-23。Browserの追加チップ対応を整えてからNativeの独立チップ対応へ進む。
Mixer保存は、ユーザーが選択した「共通初期値＋プロジェクト別の調整」を実装する。

## 保存先と優先順位

1. 音源の組込み初期値。
2. アプリ共通のチップ種類ごとのVolume／Pan。
3. プロジェクト内の明示IDごとのVolume／Pan／Mute／Solo。

共通初期値はMixerの各音源の **Set common default** で明示的に保存する。
通常のスライダー・Mute／Solo操作は、プロジェクトの調整として保存する。
共通初期値のキーは`tetorica.playground.mixer.defaults.v1`。
同じoriginの各Modeと新しいCassetteで共有する。Mute／Soloは共通初期値へ含めない。
共通初期値のリセットと、音源のプロジェクト調整を外す **Use defaults** を用意する。

プロジェクト設定はVirtual Filesの`/mixer/state.json`へ保存する。
Cassette、Git、Desktop autosave、Mode／backend切替のプロジェクト引継ぎに含まれる。
初期値を使って音源を接続しただけではファイルを作らず、明示的な変更だけを保存する。
スライダーの変更は250msでまとめ、保存・ページ離脱・snapshot取得時には先にflushする。
通常の更新では設定JSONだけを変更し、ファイルの追加・削除時だけ一覧を描き直す。
スライダー操作のたびにVirtual Files全体や音声ファイルをコピーしない。

```json
{
  "version": 1,
  "entries": [
    {"id": "lead", "name": "segapsg", "settings": {"volume": 0.6, "pan": -0.2}}
  ]
}
```

追加チップの自動採番IDは再生成時に変わるため保存しない。
個別の調整を保持する音源には明示IDを付ける。

```js
const lead = await createSoundChip('segapsg', {id: 'lead'});
await mixer.set(lead.id, {volume: 0.6, pan: -0.2});
```

種類ごとの初期値だけで十分なら、自動IDのまま **Set common default** を使える。
同じIDを別のチップ種類へ使い直しても、以前の種類の調整を誤適用しない。
手編集したJSONは検証後にまとめて反映し、壊れたJSONを自動保存で上書きしない。
設定JSONは2 MiBまでとし、保存モデルの上限512件をエスケープ付きIDでも扱える。
新しいプロジェクトに古いMute／SoloやID別調整は引き継がず、共通初期値を使う。

## 音源の異常終了

PSGなど13種類のAudio factoryでは、初期化後の異常終了時にlocalなdisposeを呼び、
Runtimeが追加したMixer解除・Inspector解除・キャッシュの破棄を通らない経路があった。
イベント駆動の共通watcherから、その時点のラップ済みdisposerを呼ぶ形へ統一した。
初期化中の失敗処理は保持し、通常の音声処理やpollingは追加しない。

Workerへも破棄を通知して、取得済みの死んだハンドルをキャッシュから外す。
通知と`pcm.dispose`にはインスタンス番号を付け、同じIDで作り直した音源を
遅延した古い破棄メッセージが閉じないようにする。
入力検証のエラーやInspectorの操作エラーは、正常な音源の異常終了として扱わない。
ID付きのPerformance／Clock RPCの拒否も呼出元へ返し、正常な音源を破棄しない。
`fatal: true`やprocessor errorは確実に破棄する。

## 検証

- JavaScript全体で4,172件成功、1件skip。
- 異常終了の専用88件、RPCなどを含む関連172件成功。
  全21種類のfactory、実Worker、同じIDの再生成、RPC拒否後の再試行を含む。
- 保存モデルの専用17件、関連558件成功。共通初期値と個別調整の優先順位、
  明示ID／自動ID、種類の結び付け、接続中の解除処理、読み込みの一括検証を含む。
- 保存controllerの10件成功。Cassette往復、New Project、手編集、壊れたJSON、
  保存先の拒否、flush、取消し、購読・タイマーの解除、上限内の長いIDを含む。
- Chromium／WebKitで実際のMixer UI、IndexedDB再読み込み、New Cassette、
  ZIPの保存・読み込み、壊れたJSONの保護・修復を確認。
  最終Tauri配布データでも両方成功。共通初期値が壊れた状態の実際の再読み込みで、
  画面の起動・コードと個別調整の復元・壊れた元データの保持まで確認した。
- Playground／Synth／VGM Analyzerの配布ZIPを作成し、新しい共通watcherを含む
  依存ファイルを確認。Tauriへ847ファイルを取り込み、source ZIPの1,306ファイルと
  Nativeの21種類のソースsnapshotの整合も確認。

実音声デバイスを開かず、異常終了はAudioNode／MessagePortの模擬と実Workerで確認する。
音源自体のDSPや周波数は変更しない。Nativeでも同じMixer保存モデルを使う。
