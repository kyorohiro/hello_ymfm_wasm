// Each mode owns its starter and a small set of editable examples.
const mixedChipScene = '/examples/genesis/mixed-chip-stability.js';
const chipComparison = '/examples/genesis/chip-level-comparison.js';
const ym2612EngineComparison = '/examples/genesis/ym2612-engine-comparison.js';
const fullExamples = [
  '/examples/genesis/genesis-mode-duet.js',
  '/examples/genesis/rf5c164-sine.js',
  '/examples/genesis/32x-pwm-sine.js',
  mixedChipScene,
  chipComparison,
  ym2612EngineComparison,
];
const opnbExamples = [
  '/examples/neogeo/neogeo-opnb-duet.js',
  '/examples/neogeo/neogeo-opnb-sections.js',
  '/examples/neogeo/neogeo-sampler.js',
  '/examples/neogeo/neogeo-adpcm-a-drums.js',
];
const definitions = {
  genesis: null,
  'mega-cd': ['/examples/mega-cd/megacd-four-sources.js', '/examples/mega-cd/megacd-pcm-loop.js', '/examples/mega-cd/megacd-sampler.js'],
  'genesis-full': fullExamples,
  'genesis-full-nuked': fullExamples,
  'pc98-26': ['/examples/pc98/pc98-opn-melody.js', '/examples/pc98/pc98-opn-ssg.js'],
  pc98: ['/examples/pc98/pc98-opna-groove.js', '/examples/pc98/pc98-opna-sections.js', '/examples/pc98/pc98-sampler.js'],
  neogeo: opnbExamples,
  'neogeo-b': ['/examples/neogeo/neogeo-opnb-sections.js', '/examples/neogeo/neogeo-b-six-channel.js', '/examples/neogeo/neogeo-sampler.js', '/examples/neogeo/neogeo-adpcm-a-drums.js'],
  wonderswan: ['/examples/wonderswan/ws-four-voices.js','/examples/wonderswan/ws-stereo.js','/examples/wonderswan/ws-noise-sweep.js'],
  gameboy: ['/examples/gameboy/gameboy-mode-pulse.js', '/examples/gameboy/gameboy-mode-wave.js', '/examples/gameboy/gameboy-sampler.js'],
  nes: ['/examples/nes/nes-mode-pulse.js','/examples/nes/nes-mode-fds.js','/examples/nes/nes-mode-rhythm.js'],
  scsp: ['/examples/scsp/scsp-stereo-pcm.js','/examples/scsp/scsp-two-slot-fm.js'],
  ps1: ['/examples/ps1/ps1-stereo-voices.js','/examples/ps1/ps1-adpcm-wave.js',
    '/examples/ps1/ps1-pcm-adpcm.js','/examples/ps1/ps1-sampler.js'],
  snes: ['/examples/snes/snes-mode-brr.js','/examples/snes/snes-mode-stereo.js','/examples/snes/snes-pcm-brr.js'],
  x68000: ['/examples/x68000/x68000-mode-opm.js','/examples/x68000/x68000-mode-adpcm.js'],
  'pc-engine': ['/examples/pc-engine/pce-mode-wave.js','/examples/pc-engine/pce-mode-stereo.js','/examples/pc-engine/pce-mode-noise.js','/examples/pc-engine/pce-cdda.js'],
  'pc-engine-cd': ['/examples/pc-engine/pce-cd-three-sources.js','/examples/pc-engine/pce-cdda.js','/examples/pc-engine/pce-mode-stereo.js'],
  'game-gear': ['/examples/game-gear/gg-mode-melody.js', '/examples/game-gear/gg-mode-noise.js', '/examples/game-gear/gg-mode-stereo.js'],
  'master-system': ['/examples/master-system/sms-mode-melody.js', '/examples/master-system/sms-mode-noise.js',
    '/examples/master-system/sms-opll-instruments.js', '/examples/master-system/sms-opll-user-patch.js', '/examples/master-system/sms-opll-rhythm.js'],
  'atari-st': ['/examples/atari-st/st-three-voices.js','/examples/atari-st/st-tone-noise.js','/examples/atari-st/st-shared-envelope.js'],
  pokey: ['/examples/pokey/pokey-four-voices.js','/examples/pokey/pokey-distortions.js'],
  'pokey-dual': ['/examples/pokey/pokey-dual-melody.js','/examples/pokey/pokey-dual-alternating.js'],
  msx: ['/examples/msx/msx-ay-tone-noise.js','/examples/msx/msx-ay-envelope.js','/examples/msx/msx-music-duet.js'],
  'msx-audio': ['/examples/msx/msx-fm-sections.js','/examples/msx/msx-audio-adpcm.js','/examples/msx/msx-ay-tone-noise.js'],
  dx7: ['/examples/dx7/dx7-object-preset.js', '/examples/dx7/dx7-live-parameters.js', '/examples/dx7/dx7-keyboard.js'],
  ym3526: ['/examples/opl/opl-melody.js', '/examples/opl/opl-live-operators.js', '/examples/opl/opl-rhythm.js'],
  ym3812: ['/examples/opl/opl-melody.js', '/examples/opl/opl-live-operators.js', '/examples/opl/opl-rhythm.js'],
  ymf262: ['/examples/opl/opl-melody.js', '/examples/opl/opl3-four-operators.js', '/examples/opl/opl3-stereo.js'],
  'genesis-nuked': null,
};

export const MODE_STARTERS = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id, examples]) => [id,
  Object.freeze({index:`${id}/index.js`, examples:examples && Object.freeze([...examples])}),
])));

// The original Genesis library remains available, excluding examples written
// specifically for the native globals of a different machine.
const nativeExamples = new Set(Object.entries(definitions)
  // DX7 examples borrow with useSoundChip and also work in the Genesis library.
  .filter(([id]) => !id.startsWith('genesis') && id !== 'dx7').flatMap(([, examples]) => examples ?? []));
// Keep the old mode-only example usable in saved cassettes without adding it to Genesis.
nativeExamples.add('/examples/gameboy/gameboy-mode-noise.js');
nativeExamples.add('/examples/mega-cd/megacd-fm-pcm.js');
// Independent chips make this one source usable across the Genesis modes.
nativeExamples.delete(mixedChipScene);
nativeExamples.delete(chipComparison);
nativeExamples.delete(ym2612EngineComparison);

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
