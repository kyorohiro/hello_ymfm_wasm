// Each mode owns its starter and a small set of editable examples.
const fullExamples = [
  '/examples/genesis/genesis-mode-duet.js',
  '/examples/genesis/rf5c164-sine.js',
  '/examples/genesis/32x-pwm-sine.js',
];
const opnbExamples = [
  '/examples/neogeo/neogeo-opnb-duet.js',
  '/examples/neogeo/neogeo-opnb-sections.js',
  '/examples/neogeo/neogeo-sampler.js',
];
const definitions = {
  genesis: null,
  'mega-cd': ['/examples/mega-cd/megacd-pcm-loop.js', '/examples/mega-cd/megacd-fm-pcm.js', '/examples/mega-cd/megacd-sampler.js'],
  'genesis-full': fullExamples,
  'genesis-full-nuked': fullExamples,
  'pc98-26': ['/examples/pc98/pc98-opn-melody.js', '/examples/pc98/pc98-opn-ssg.js'],
  pc98: ['/examples/pc98/pc98-opna-groove.js', '/examples/pc98/pc98-opna-sections.js', '/examples/pc98/pc98-sampler.js'],
  neogeo: opnbExamples,
  'neogeo-b': ['/examples/neogeo/neogeo-opnb-sections.js', '/examples/neogeo/neogeo-b-six-channel.js', '/examples/neogeo/neogeo-sampler.js'],
  gameboy: ['/examples/gameboy/gameboy-mode-pulse.js', '/examples/gameboy/gameboy-mode-wave.js', '/examples/gameboy/gameboy-sampler.js'],
  nes: ['/examples/nes/nes-mode-pulse.js','/examples/nes/nes-mode-fds.js','/examples/nes/nes-mode-rhythm.js'],
  snes: ['/examples/snes/snes-mode-brr.js','/examples/snes/snes-mode-stereo.js'],
  x68000: ['/examples/x68000/x68000-mode-opm.js','/examples/x68000/x68000-mode-adpcm.js'],
  'pc-engine': ['/examples/pc-engine/pce-mode-wave.js','/examples/pc-engine/pce-mode-stereo.js','/examples/pc-engine/pce-mode-noise.js'],
  'game-gear': ['/examples/game-gear/gg-mode-melody.js', '/examples/game-gear/gg-mode-noise.js', '/examples/game-gear/gg-mode-stereo.js'],
  'master-system': ['/examples/master-system/sms-mode-melody.js', '/examples/master-system/sms-mode-noise.js'],
  'genesis-nuked': null,
};

export const MODE_STARTERS = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, examples]) => [id,
  Object.freeze({index:`${id}/index.js`, examples:examples && Object.freeze([...examples])}),
])));

// The original Genesis library remains available, excluding examples written
// specifically for the native globals of a different machine.
const nativeExamples = new Set(Object.entries(definitions)
  .filter(([id]) => !id.startsWith('genesis')).flatMap(([, examples]) => examples ?? []));
// Keep the old mode-only example usable in saved cassettes without adding it to Genesis.
nativeExamples.add('/examples/gameboy/gameboy-mode-noise.js');

export function selectModeExamples(files, modeId) {
  const definition = MODE_STARTERS[modeId];
  if (!definition) throw new Error(`Unsupported example mode: ${modeId}`);
  if (!definition.examples) return files.filter(file => !nativeExamples.has(file.path));
  const byPath = new Map(files.map(file => [file.path, file]));
  return definition.examples.map(path => {
    const file = byPath.get(path);
    if (!file) throw new Error(`Missing ${modeId} example: ${path}`);
    return file;
  });
}
