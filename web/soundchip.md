# Sound chip factories

`createSoundChip` は既存の低レベルチップを初期化する入口です。
音色の設定、Note On、スピーカー出力を追加するものではありません。

```javascript
import { createSoundChip } from './soundchip.js';
const opm = await createSoundChip('ym2151');
try {
  // opm.write(...) でレジスタ設定後、opm.generateStereo(...) でPCM生成。
} finally {
  opm.dispose();
}
```

対応名: `ay8910`, `y8950`, `ym2151`, `ym2203`, `ym2413`, `ym2608`,
`ym2610b`, `ym2612`, `ym3438`, `ym3526`, `ym3812`, `ymf262`, `ymf276`,
`ymf278b`, `ymf288`。各ラッパーの機能・ROM要件はそのままです。

Node.jsではローカルWASMを読み込み、ブラウザーでは生成済みモジュールの
ローダーがWASMを取得します。Web AudioやDOMは使いません。
ソースツリーでは `docs/generated/`、公開用 `docs/js/` では隣の `generated/`
を既定の配置とします。別の配置ならディレクトリURLを指定してください。

```javascript
const chip = await createSoundChip('ymf262', {
  assetBaseUrl: new URL('./assets/chips/', import.meta.url),
});
```

`moduleFactory` を渡すと自動ロードを省略し、`moduleOptions` をそのまま渡します。
`moduleOptions.wasmBinary` や `locateFile` でWASM読み込みを指定することもできます。

## ゲームに必要なチップだけ同梱する

便利な共通入口は動的importを含みます。配布物に何が含まれるかはバンドラー次第です。
最小構成には、チップを一切importしない `soundchip_factory.js` を使ってください。

```javascript
import { createSoundChipFactory } from './soundchip_factory.js';
import { Ym2151 } from './ym2151.js';
import moduleFactory from './generated/ym2151_wasm.js';

const createSoundChip = createSoundChipFactory({
  ym2151: (options = {}) => Ym2151.create({ moduleFactory, ...options }),
});
const opm = await createSoundChip('ym2151');
// 使用後に opm.dispose()
```

この例のWASMは `ym2151_wasm.js` と同じ場所に置きます。登録したローダーは
生成要求時だけ実行されます。複数回呼ぶと独立したチップを生成し、共有しません。
この登録方式にはNode.js固有の依存もありません。Workerでは必要に応じて
WASMバイナリーとmoduleFactoryをローダーへ注入できます。
