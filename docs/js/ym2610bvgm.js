/**
 * @file ym2610bvgm.js
 * 実行環境: Browser / Node.js
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
/** YM2610B VGM facade. Native exports retain YM2610 FM register values. */
export {
  Ym2612VGM as Ym2610BVGM,
  exportYm2610BVgmToPlaygroundJavaScript,
} from "./ym2612vgm.js";
