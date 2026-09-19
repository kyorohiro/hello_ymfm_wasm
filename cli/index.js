import { readFile } from 'node:fs/promises';
import { decodeSource, decodeSourceDocument } from '../docs/vgm_analyzer/analyzer_core.js';
export * from '../docs/vgm_analyzer/analyzer_core.js';
export { renderSource } from './render.js';
export async function readSource(path) { return decodeSource(await readFile(path)); }

export async function readSourceDocument(path) { return decodeSourceDocument(await readFile(path)); }


export async function exportNodeSamples(source, options = {}) {
  const {getNodePlaybackFactory}=await import('./render.js');
  const {exportSourceSamples}=await import('../docs/vgm_analyzer/analyzer_core.js');
  return exportSourceSamples(source,{...options,getFactory:getNodePlaybackFactory});
}
