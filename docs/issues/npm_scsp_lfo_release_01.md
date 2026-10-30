# tetorica-fm2612 0.2.36 release — 2026-10-31

ユーザーのLFO試聴確認とnpm更新指示を受け、0.2.36を公開。
SCSP hardware LFOのlive API／preset／state／型、Main／Worker／対応Native transport、
低速位相とreset修正を含む固定SDK／WASM、および校正更新を含む。
READMEと同梱source案内を更新。C/C++提供元のSDKリンクと未公開candidateの出自を維持。

`node scripts/check_fm2612_package.mjs` 成功。隔離install、SCSP実WASM・setLfo、
従来音源、28 WASM engines／15 renderers、NodeNext／Bundler正負型、Node ambientなしbrowser型を確認。
公開tarballの1,051 filesは検証stageとbyte一致。旧0.2.35 tarballは変更なし。
[artifact hashと公開確認](npm_scsp_lfo_release_01.json)。

npmのWeb追加認証をユーザーが完了し、publishはexit 0と `+ tetorica-fm2612@0.2.36` を返した。
registryのversion／latestが0.2.36に更新済み。公開tarballを再取得し、検証済みtarballと全byte／SHA1／SHA512一致を確認。
`npm install tetorica-fm2612@0.2.36` で取得できる。commit／push、SDK別repo公開、itch公開は今回実施しない。
