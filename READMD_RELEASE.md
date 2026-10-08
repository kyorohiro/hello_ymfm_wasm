# npm リリース手順

パッケージごとの手順に分けています。リポジトリのルートから実行してください。

| パッケージ | 手順 | バージョンの設定先 | packコマンド |
|---|---|---|---|
| `tetorica-vgm` | [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) | `packages/vgm/package.json` | `npm run pack:vgm` |
| `tetorica-fm2612` | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md) | `packages/fm2612/package.json` | `npm run pack:fm2612` |

検証済みのtgzを指定して公開します。ルートの `package.json` は開発用の
`private: true` です。配布物はそれぞれ `dist/vgm/` と `dist/fm2612/` に生成します。
