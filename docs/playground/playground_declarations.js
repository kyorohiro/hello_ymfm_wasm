/** Filter convenience globals to match the selected primary environment. */
export function selectPlaygroundDeclarations(source, chip) {
  const genesis = chip === 'ym2612' || chip === 'mega-cd';
  const segaPsg = chip === 'game-gear' || chip === 'master-system';
  const opl = ['ym3526','ym3812','y8950','ymf262','msx-audio'].includes(chip);
  const native = opl || segaPsg || ['wonderswan','pokey','pokey-dual','gameboy','nes','snes','x68000','huc6280','pc-engine-cd','dx7','msx','atari-st'].includes(chip);
  const channels = native ? 0 : chip === 'ym2203' ? 3 : chip === 'ym2610' ? 4 : 6;
  let declarations = source.replace(/^declare const CH(\d+): \d+;\n/gm, (line, number) =>
    Number(number) <= (genesis ? 16 : channels) ? line : '');
  if (!genesis) {
    declarations = declarations
      .replace(/^declare function psg(?:Tone|Noise)\([^\n]*\): void;\n/gm, '')
      .replace(/^declare const dac: \{[\s\S]*?^\};\n/gm, '');
    if (!segaPsg) declarations = declarations
      .replace(/^declare const psg: PlaygroundSelectedPsg;\n/gm, '')
      .replace(/^declare const PSG[123]: [012];\n/gm, '');
  }
  const opna = chip === 'ym2608';
  const opnb = chip === 'ym2610' || chip === 'ym2610b';
  if (chip !== 'ym2203' && !opna && !opnb) declarations = declarations.replace(
    /^declare const ssg: [^\n]+\n/gm, '');
  if (!opna && !opnb && chip !== 'x68000' && chip !== 'pc-engine-cd') declarations = declarations.replace(/^declare const adpcm: [^\n]+\n/gm, '');
  if (!opna) declarations = declarations.replace(/^declare const rhythm: [^\n]+\n/gm, '');
  if (!opnb) declarations = declarations.replace(/^declare const adpcm[AB]: [^\n]+\n/gm, '');
  if (native) {
    declarations = declarations
      .replace(/^declare const (?:fm|midi|FM_PRESETS|OP[1234]): [^\n]+\n/gm, '')
      .replace(/^declare function (?:play|write|scheduleWritesSamples|noteToBlockFnum|hzToBlockFnum|noteLerp|tfiToPreset|vgiToPreset|setDacLookahead|getDacLookahead)\([^\n]*\): [^\n]+\n/gm, '');
  }
  if (!opl) declarations = declarations.replace(/^declare const OPL_PRESETS: [^\n]+\n/gm, '');
  if (!['master-system','msx','msx-audio'].includes(chip)) declarations = declarations.replace(/^declare const OPLL_(?:INSTRUMENTS|USER_PRESETS): [^\n]+\n/gm, '');
  const nativeGlobals = {wonderswan:['ws'],pokey:['pokey'],'pokey-dual':['pokey','pokey2'],gameboy:['gameboy'], nes:['nes'], snes:['snes'], x68000:['opm'], huc6280:['pce'], 'pc-engine-cd':['pce'], dx7:['dx7'],
    ym3526:['opl'], ym3812:['opl'], y8950:['opl'], ymf262:['opl'], 'master-system':['opll'],msx:['ay','opll'],'msx-audio':['ay','opll','opl'],'atari-st':['ay']};
  const selected = nativeGlobals[chip] ?? [];
  declarations = declarations.replace(/^declare const (ws|pokey|pokey2|gameboy|nes|snes|opm|pce|dx7|opl|opll|ay): [^\n]+\n/gm,
    (line, name) => selected.includes(name) ? line : '');
  return declarations;
}
