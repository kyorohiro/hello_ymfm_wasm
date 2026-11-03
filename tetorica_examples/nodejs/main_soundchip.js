/** Node.js: 名前から低レベルチップを作り、PCM生成を確認する。 */
import { createSoundChip } from '../../web/soundchip.js';

for (const name of ['ym2151', 'ymf262']) {
  const chip = await createSoundChip(name);
  try {
    // リセット直後は無音。発音にはチップ固有のレジスタ設定が必要。
    const pcm = chip.generateStereo(128);
    console.log(`${name}: ${chip.sampleRate()} Hz, ${pcm.left.length} frames`);
  } finally {
    chip.dispose();
  }
}
