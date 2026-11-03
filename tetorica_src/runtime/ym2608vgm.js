/**
 * @file ym2608vgm.js
 * 実行環境: Browser / Node.js
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
/**
 * YM2608 VGM facade. Native exports preserve the VGM FNUM/block values.
 */
export {
  Ym2612VGM as Ym2608VGM,
  exportYm2608VgmToPlaygroundJavaScript,
} from "./ym2612vgm.js";
