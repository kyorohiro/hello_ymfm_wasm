/**
 * @file megasynth_looper.js
 * 実行環境: Browser / Node.js（タイマー注入時）
 * 依存: looper.js の再エクスポート。Node.js ではタイマーを注入し、接続先 Synth の条件も満たす。
 */
export { MegaSynthLooper } from "./looper.js";
