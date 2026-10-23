# Mixerのプリセット・自動保存と音源の後始末

2026-10-23。Mixerは設定JSONを選んだ瞬間に適用する方式に統一する。
Reset、Set common default／Use defaults／Reset common defaultsは廃止する。
別の共通初期値ストアは持たず、プロジェクト内のファイルとして扱う。

## 画面とファイル

Mixer上部のPreset選択肢は次のとおり。

- System（read-only）：組込み初期値。Game BoyはVolume 28%、他は100%、Pan中央、Mute／Soloなし。
  `/sys/mixer/default.json`を論理的な識別子とし、Cassetteに組込みファイルを混ぜない。
- `mixer/default.json`：編集可能な既定プリセット。New Cassetteでこのファイルだけを
  コピーし、次のプロジェクトのMixer初期値にする。通常の調整では書き変えない。
- `mixer/current.json`：今のVolume／Pan／Mute／Soloを自動保存するファイル。
- `mixer/`直下の他のJSON：保存済みプリセット。`current.json`をコピーして別名で残せる。

選択した瞬間に設定全体を適用する。調整後は選択表示がcurrentへ移るので、
元のSystem／default／名前付きプリセットを再選択すれば、その設定へ戻れる。
JSONは全部を検証してから、種類ごとの初期値とID別設定を音声出力へ一度に反映する。
プリセット選択だけではcurrentを作成・上書きしない。currentを選べば最後に実際に調整した
状態へ戻れる。別のプリセットを選ぶ直前に実編集が保留されていれば、その編集だけを
flushしてから適用し、選択先の値は保存しない。不正な選択先はflush前に拒否する。
起動・接続・切断や、チップ種類情報の補完も実編集として扱わない。

**Set default** は今の設定全体を`mixer/default.json`へ保存する。
**Save** は名前入力ダイアログで`mixer/<名前>.json`へ保存する。
ダイアログの`mixer/`は固定表示し、ファイル名だけ編集する。初期値は`mix.json`で、
使用済みなら`mix-2.json`などを提案する。最初は拡張子以外を選択しておく。
保存前にcurrentの保留中の変更をflushする。名前は拡張子を含め120文字までとし、
current／defaultの予約名、パス区切り、制御文字、同名ファイル・ディレクトリは拒否する。
既存プリセットの上書きは行わず、エラー時はダイアログ内に理由を表示する。
入力中のキーはauditionへ伝えず、keyupは既存の発音解除へ届ける。

起動・プロジェクト読込みはcurrent、旧state、default、Systemの順に参照する。
defaultのJSONを直接編集しても演奏中の設定は変わらず、選択またはNew Cassetteで適用される。
旧`mixer/state.json`はcurrentが存在しない場合だけ読み、実編集があればcurrentへ保存する。
読み込んだだけではコピーしない。旧ファイルは保持し、プリセットとしても選べる。

```json
{
  "version": 1,
  "entries": [
    {"id": "lead", "name": "segapsg", "settings": {"volume": 0.6, "pan": -0.2}}
  ]
}
```

必要なら`kinds`配列で音源種類ごとのVolume／Panも同じJSONに含められる。
追加音源の個別設定を保持するには`createSoundChip('segapsg', {id: 'lead'})`のように
固定IDを付ける。自動採番IDの個別設定は保存しない。

## 保存と保護

currentの変更は250msにまとめ、Cassette保存・snapshot・ページ離脱前にはflushする。
ファイルの追加・削除時だけ一覧を描き直し、通常のスライダー保存で全サンプルをコピーしない。
プリセット候補は`readdir('/mixer')`で取得し、描画フレームからのpollingは追加しない。

Cassette、Git、Desktop autosave、Mode／backend切替には通常のVirtual Filesとして含まれる。
New Cassetteで引き継ぐのはdefaultのみ。currentや他のプリセットは新しいプロジェクトへ持ち越さない。
壊れたJSON、binary、同名ディレクトリは自動保存で上書きしない。
不正なプリセットを選んでも、現在の音声設定を部分的に変更しない。
JSONは2 MiBまでとし、512件のエスケープ付きIDも保存・再読込みできる。

## 音源の異常終了

Browserの13種類のAudio factoryは、初期化後の異常終了時にその時点のラップ済みdisposerを呼ぶ。
Mixer・Inspector解除とキャッシュ破棄を一緒に実行し、Workerにもインスタンス番号付きで通知する。
古い破棄通知が同じIDで作り直した音源を閉じないようにする。
ID付きPerformance／Clock RPCの拒否は呼出元へ返し、正常な音源を破棄しない。
明示的なfatalやprocessor errorは破棄する。DSP・周波数計算は変更しない。

## 検証

音声デバイスを開かず、保存controller・MixerのNodeテストと、Native IPCを模擬した
Chromium／WebKitの実画面操作で確認する。対象はPreset即時選択、Set default／名前付きSave、defaultのNew Cassette引継ぎ、
current自動保存、IndexedDB・Cassette ZIPの往復、不正JSONの保護、旧state互換。
配布ZIPの依存ファイルとTauri取込み、Native source ZIPの整合も確認する。

保存controllerの29件、JavaScript全体4,194件が成功（1件skip）。最終配布データで
Chromium／WebKitの選択後の待機・snapshotでもcurrentの元データが保持されること、
実編集後だけの保存、固定保存先と初期ファイル名、Set default／Saveも確認した。
Tauriへ847ファイルを取り込み、21種類のNativeソースsnapshotとsource ZIPの
1,306ファイルの一致も確認済み。
