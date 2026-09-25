// Descriptors only. Audio rendering and summing run inside C/WASM.
export const branch = (...children) => ({ type: 'chain', children });
export const parallel = (...children) => ({ type: 'parallel', children });
export const effect = (type, slot = 0) => ({ type, slot });
export const types = { chain: 0, parallel: 1, gain: 2, eq: 3, gate: 4, compressor: 5, reverb: 6, filter: 7, delay: 8, distortion: 9, bitcrusher: 10, wobble: 11, flanger: 12, slicer: 13, chorus: 14 };
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
export function extraChain() {
  return ['filter', 'distortion', 'bitcrusher', 'wobble', 'slicer', 'flanger', 'chorus', 'delay'].map(name => effect(name));
}
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
