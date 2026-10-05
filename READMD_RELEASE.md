# npm リリース手順

パッケージごとの手順に分けています。リポジトリのルートから実行してください。

| パッケージ | 手順 | バージョンの設定先 | packコマンド |
|---|---|---|---|
| `tetorica-vgm` | [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) | `package.json` | `npm run pack` |
| `tetorica-fm2612` | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md) | `packages/fm2612/package.json` | `npm run pack:fm2612` |

検証済みのtgzを指定して公開します。ルートで引数なしの `npm publish` を実行すると、
`tetorica-vgm` が対象になります。
