// Descriptors only. Audio rendering and summing run inside C/WASM.
/**
 * @typedef {{type: string, slot?: number, children?: NativeFXGraphNode[]}} NativeFXGraphNode
 * @typedef {{graph_begin: () => void, graph_add: (type: number, slot: number) => number,
 *   graph_append: (parent: number, child: number) => number,
 *   graph_commit: (root: number) => number}} NativeFXGraphApi
 */
/** @param {...NativeFXGraphNode} children Nodes processed in series.
 * @returns {NativeFXGraphNode} Serial-chain descriptor. */
export const branch = (...children) => ({ type: 'chain', children });
/** @param {...NativeFXGraphNode} children Branches whose outputs are summed.
 * @returns {NativeFXGraphNode} Parallel descriptor. */
export const parallel = (...children) => ({ type: 'parallel', children });
/** @param {string} type Effect name in types.
 * @param {number} [slot=0] Effect instance slot (0..7).
 * @returns {NativeFXGraphNode} Effect descriptor; no audio resources are created. */
export const effect = (type, slot = 0) => ({ type, slot });
export const types = { chain: 0, parallel: 1, gain: 2, eq: 3, gate: 4, compressor: 5, reverb: 6, filter: 7, delay: 8, distortion: 9, bitcrusher: 10, wobble: 11, flanger: 12, slicer: 13, chorus: 14 };
/**
 * Build and commit a native graph, wrapping children in a serial root.
 * @param {NativeFXGraphApi} api Native WASM graph exports.
 * @param {NativeFXGraphNode[]} children Ordered top-level descriptors.
 * @returns {void}
 * @throws {Error} For invalid graphs, repeated FX instances or the 32-node limit.
 */
export function setChain(api, children) {
  api.graph_begin();
  let count = 0;
  function add(node) {
    if (!node || ++count > 32 || !Object.hasOwn(types, node.type)) throw new Error('Invalid graph (maximum 32 nodes)');
    const children = node.children ?? [];
    if (!Array.isArray(children) || (types[node.type] > 1 && children.length)) throw new Error('Invalid children');
    const ids = children.map(add);
    const slot = node.slot ?? 0;
    if (!Number.isInteger(slot) || slot < 0 || slot >= 8) throw new Error('Invalid FX slot');
    const id = api.graph_add(types[node.type], slot);
    if (id < 0) throw new Error('Graph capacity exceeded');
    for (const child of ids) if (!api.graph_append(id, child)) throw new Error('Invalid connection');
    return id;
  }
  const root = add(branch(...children));
  if (!api.graph_commit(root)) throw new Error('Invalid graph: empty parallel or repeated FX instance');
}
/** @returns {NativeFXGraphNode[]} Default extra effects in serial order, all in slot zero. */
export function extraChain() {
  return ['filter', 'distortion', 'bitcrusher', 'wobble', 'slicer', 'flanger', 'chorus', 'delay'].map(name => effect(name));
}
/** @param {'serial' | 'parallel' | 'dual' | 'extended'} mode Routing preset.
 * @returns {NativeFXGraphNode[]} Top-level descriptors ready for setChain.
 * @throws {Error} For an unknown routing mode. */
export function preset(mode) {
  const front = [effect('gain'), effect('eq'), effect('gate')];
  if (mode === 'parallel') return [...front, effect('compressor'), parallel(
    branch(effect('gain', 1)), branch(effect('reverb'), effect('gain', 2)),
  )];
  if (mode === 'dual') return [...front, parallel(
    branch(effect('compressor'), effect('gain', 1)),
    branch(effect('compressor', 1), effect('gain', 2)),
  ), effect('reverb')];
  if (mode === 'extended') return [...front, effect('compressor'), ...extraChain(), effect('reverb')];
  if (mode !== 'serial') throw new Error('Unknown routing mode');
  return [...front, effect('compressor'), effect('reverb')];
}
