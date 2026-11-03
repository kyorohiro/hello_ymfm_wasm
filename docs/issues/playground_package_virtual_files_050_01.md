# Playground配布：virtual-files 0.5.0更新

2026-11-03。ユーザーの`sh scripts/package_itch_playground.sh`が、Git bundleの校正ソース変更エラーで停止した。

## TODO

- [x] 現在の校正報告とGit／Shell更新の差分を調べる。
- [x] 既知のGit／Shell更新だけを完全なbefore／afterハッシュで承認する。DSP・WASM等の未確認変更は引き続き拒否する。
- [x] PS1・WonderSwan・POKEY・SCSPの各検証へ適用し、不正変更の拒否を回帰テストで確認する。
- [x] 通常のPlayground配布コマンドを実行し、完全ソース版とブラウザー実行版ZIPの生成・依存を確認する。

## 原因と範囲

- 音声校正時のserved source一覧には、演奏処理のほかGit／Shellも含まれている。
- `virtual-files@0.5.0`の`git clone`、`git remote rm/remove`、rmの追加オプション対応で、`docs/js/tetorica_virtual_files/git.bundle.js`と`shell.js`が変わった。
- 変更はコミット`77184264`と`0d63d895`。測定時の元ファイルは`e3faa5cd`で復元できる。今回承認するのは下表の2組だけとし、将来の変更を自動承認しない。
- 過去の測定報告や生成済みMixerのgainを書き換えず、音声の再測定を行ったとは扱わない。

| Path（docs/以下） | Before bytes / SHA256 | After bytes / SHA256 |
| --- | --- | --- |
| js/tetorica_virtual_files/git.bundle.js | 298711 / `48bf6973ab36ecb1824c4b52c9e958d1d626b6796a47c0cf4d9b9e5f34ef89d1` | 302649 / `73d534801173e5a9afb2f6e88b4e2149d87c682823a1c1cff25ea989aa5e468f` |
| js/tetorica_virtual_files/shell.js | 11716 / `a542bdeffd9853d43b28a453fcd973963f96c3c078079437383ef6c1565633ed` | 12584 / `e0e9947bd4b83a8765ee4e6e763469b41fe0df077301b61ef4ccba09671cb2ab` |

## 検証結果

- 校正・generator等の関連361件と、新規の厳密なGit/Shell改訂・VAB回帰8件、合計369件が成功した。4種類のsource validator、1バイト変更・追記・異なるbefore・未対象パス・DSP/WASM変更の拒否、元報告と生成済みgainの不変を確認した。
- `sh scripts/package_itch_playground.sh`が成功。1,206個のローカルmodule／asset参照と全mode starter・Native API・WASM・ライセンスを検証した。
- 完全ソースZIP：`release/hello_ymfm_wasm_dev_itch_playground.zip`。1,121 files、37,179,810 bytes。
- itch.io実行用ZIP：`release/hello_ymfm_wasm_dev_itch_playground_for_run.zip`。968 entries／files、ディレクトリーentryなし、37,619,962 bytes。itchの1,000-entry制限内。
- 両ZIPのCRCと、上記2ファイルが現在のcanonical sourceとバイト一致することも確認した。SHA256等は[検証JSON](playground_package_virtual_files_050_01.json)を参照。
- 公開・タグ作成やTauri配布の更新は実施していない。
