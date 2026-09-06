Cassette Export 時の License / Work Type 指定を追加してください。

目的:
Cassette を他のユーザーへ配布したときに、

- オリジナル作品なのか
- 耳コピ / Cover / VGM Import 由来なのか
- 作者自身が作成した部分をどの条件で再利用できるのか

を Cassette 自体から判断できるようにしたいです。

重要:
「Transcription / Cover」は License ではありません。
Work Type と License を分離して扱ってください。


## UI

Export Cassette 実行時に、Export前の設定画面で以下を指定できるようにしてください。


### Work Type

以下の2つを選択できるようにしてください。

- Original
- Transcription / Cover

説明:

Original
  This cassette is an original work.

Transcription / Cover
  This cassette reproduces, transcribes, covers, or is derived from an existing work.
  Rights to the original work are not granted by this cassette.


### License for author's contribution

以下から選択できるようにしてください。

- Private Only
- CC0
- CC BY
- None

説明:

Private Only
  Reuse of the author's contribution is not granted.

CC0
  The author's contribution may be freely used, modified, and redistributed.

CC BY
  The author's contribution may be used, modified, and redistributed with attribution.

None
  No license is specified for the author's contribution.


## Transcription / Cover の意味

Transcription / Cover を選択した場合でも、
作者自身が作成した部分の License は別途指定できるようにしてください。

例えば:

Work Type:
  Transcription / Cover

License:
  CC BY

の場合は、

「このCassetteは既存作品の耳コピ / Cover / VGM Import 等を含む。
原曲の権利はこのCassetteでは許諾されない。
ただし、Cassette作者自身が作成したコード、データ、編集部分等については CC BY とする」

という意味になります。

License が原曲そのものに適用されるような表現にはしないでください。


## Cassette metadata

既存のCassette metadataに、以下のような情報を追加してください。

例:

{
  "workType": "ORIGINAL",
  "license": "CC-BY-4.0"
}

固定値は以下を使用してください。

workType:

ORIGINAL
TRANSCRIPTION

license:

PRIVATE
CC0-1.0
CC-BY-4.0
NONE


## VGM Import

VGM Import から作成されたCassetteについては、

workType = TRANSCRIPTION

を初期値として扱ってください。

ユーザーがExport時に変更すること自体は妨げなくて構いません。

VGM Import由来であることを既にmetadata等で保持している場合は、
既存の仕組みを利用してください。

今回のためだけに大きなsource管理機構を追加する必要はありません。


## Import

Cassette Import 時に、

- workType
- license

を読み込み、保持してください。

Import後に再Exportしても、この情報が失われないようにしてください。


## Backward compatibility

既存Cassetteにはこれらの情報がありません。

フィールドが存在しない場合は、

workType = ORIGINAL
license = NONE

として扱ってください。

既存CassetteのImportを壊さないでください。


## Export UI behavior

通常の新規Cassetteでは、

Work Type:
  Original

を初期値として構いません。

Licenseについては、
ユーザーが意図せず自由利用を許可しないようにしてください。

CC0 や CC BY を無条件のデフォルトにはしないでください。

現時点では NONE を初期値として構いません。


VGM ImportされたCassetteでは、

Work Type:
  Transcription / Cover

を初期選択してください。


## Scope

今回は以下のみ実装してください。

- Export時の Work Type 選択UI
- Export時の License 選択UI
- Cassette metadataへの保存
- Import時の読み込み・保持
- VGM Import時の Transcription 初期値
- 既存Cassetteとの後方互換性

既存の `metadata.json` に作者独自のフィールドがある場合は、Export時に削除・初期化しない。
`workType` と `license`（およびCustomの表示名）のみExport UIの選択値で更新し、
その他のmetadataフィールドはそのまま引き継ぐ。


今回は以下を実装しないでください。

- Remix機能
- Publish機能
- Cloud / Server連携
- Remix元を辿る derivedFrom / parent ID
- Cassette UUID
- 原曲タイトル / 作曲者入力フォーム
- Source URL入力
- ライセンスによる操作制限
- 著作権や利用可否の自動判定
- ファイル単位のLicense
- 既存Cassette metadata構造の大規模な再設計


既存の Cassette Export / Import の構造をなるべく維持し、
最小限の変更で追加してください。

実装前に現在の

- Cassette metadata
- Export処理
- Import処理
- VGM Import処理

を確認し、

1. 変更対象ファイル
2. 現在のデータ構造
3. 最小変更での実装方針

を簡潔に説明してから実装してください。

勝手に仕様を拡張したり、
Remix / Server / Community機能まで実装しないでください。
