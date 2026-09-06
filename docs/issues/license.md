Cassette Export 時に License 情報を指定できるようにしてください。

目的:
Cassette を他のユーザーへ配布したときに、
再利用可能か、耳コピ作品なのか等を Cassette 自体から確認できるようにしたいです。

## UI

「Export Cassette」を実行したとき、Export前に License を選択できるようにしてください。

選択肢は以下の5つです。

- Private Only
- CC0
- CC BY
- Transcription / Cover
- None

デフォルトは None としてください。
ユーザーが明示的に選択しない限り、自由利用可能とは扱わないでください。

それぞれUI上に短い説明も表示してください。

Private Only
  Personal/private use. Reuse is not granted.

CC0
  Free to use, modify, and redistribute.

CC BY
  Free to use, modify, and redistribute with attribution.

Transcription / Cover
  This cassette reproduces or transcribes an existing work.
  Rights to the original work are not granted by this cassette.

None
  No license specified.


## Cassette format

ExportされるCassette内にライセンス情報を保存してください。

既存のCassette metadataがある場合はそこへ追加してください。
新しい独立した仕組みを作る必要はありません。

例:

{
  "license": {
    "type": "CC-BY-4.0"
  }
}

type は機械的に扱える固定値にしてください。

Export時はCassetteのルートに `metadata.json` を保存する。
既存の仮想ファイルと衝突しないよう、`metadata.json` はCassette metadata用に予約する。
既存アーカイブにこのファイルがない場合は、Import時に `NONE` として扱う。

候補:

PRIVATE
CC0-1.0
CC-BY-4.0
TRANSCRIPTION
NONE


## Transcription / Cover

Transcription / Cover は通常のオープンライセンスとは別扱いにしてください。

これは、

「既存楽曲の耳コピ、採譜、再現などを含むCassetteであり、
Cassetteの配布によって原曲の権利まで許諾されるわけではない」

ことを示すための分類です。

今回は著作権処理や利用可否の自動判定までは実装しないでください。


## Import

CassetteをImportした際もlicense metadataを保持してください。

古いCassetteにはlicense情報が存在しないため、
licenseフィールドが無い場合は NONE として扱ってください。

既存Cassetteとの後方互換性を壊さないでください。


## Scope

今回は以下だけを実装してください。

- Export時のLicense選択UI
- Cassette metadataへの保存
- Import時の読み込み・保持
- 既存Cassetteとの後方互換性

以下はまだ実装しないでください。

- Remix機能
- Publish機能
- Server / Cloud連携
- ライセンスによる操作制限
- 原曲情報入力フォーム
- ライセンスの自動判定
- ファイル単位のライセンス

## Built-in sample assets

`docs/playground/samples/sonic-pi/` contains audio files from the Sonic Pi
sample set. These files are separate from user-created Cassette content and
must not be relabeled by the Cassette Export license selector.

The bundled Sonic Pi sample assets are documented as CC0 1.0 by Sonic Pi.
Keep their attribution and license information in the sample directory's
[`README.md`](../playground/samples/sonic-pi/README.md), and keep the upstream
Sonic Pi license and sample documentation links in the project README.

If a Cassette references or includes a built-in sample, its own `license`
metadata describes the Cassette author's material only. It does not change
the license or attribution of the referenced sample asset, and it does not
grant rights to an original work used in a Transcription / Cover Cassette.

## Export dialog and inherited metadata

The Playground opens the license selector when `Export Cassette` is pressed.
If the current project was imported from a Cassette, the existing metadata is
shown and selected by default. A `Custom (*)` choice allows the author to enter
a project-specific license name or credit text.

`metadata.json` remains package metadata rather than an editable Virtual File
System source file. If a project already contains a compatible `metadata.json`,
the Export dialog may read its license value and carry it forward; the metadata
file itself is replaced by the newly exported metadata.

既存のCassette Export / Importの構造をなるべく変更せず、
最小限の変更で追加してください。

実装前に、現在のCassette metadata / Export / Importの実装箇所を確認し、
変更対象ファイルと実装方針を簡潔に説明してから作業してください。
