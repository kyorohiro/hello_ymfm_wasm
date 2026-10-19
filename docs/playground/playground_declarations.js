/** Filter convenience globals to match the selected primary environment. */
export function selectPlaygroundDeclarations(source, chip) {
  const channels = chip === 'ym2203' ? 3 : chip === 'ym2610' ? 4 : 6;
  let declarations = source.replace(/^declare const CH(\d+): \d+;\n/gm, (line, number) =>
    Number(number) <= (chip === 'ym2612' ? 16 : channels) ? line : '');
  if (chip !== 'ym2612') {
    declarations = declarations
      .replace(/^declare const psg: PSGApi;\n/gm, '')
      .replace(/^declare const PSG[123]: [012];\n/gm, '')
      .replace(/^declare function psg(?:Tone|Noise)\([^\n]*\): void;\n/gm, '')
      .replace(/^declare const dac: \{[\s\S]*?^\};\n/gm, '');
  }
  const opna = chip === 'ym2608';
  const opnb = chip === 'ym2610' || chip === 'ym2610b';
  if (chip !== 'ym2203' && !opna && !opnb) declarations = declarations.replace(
    /^declare const ssg: [^\n]+\n/gm, '');
  if (!opna && !opnb) declarations = declarations.replace(/^declare const adpcm: [^\n]+\n/gm, '');
  if (!opna) declarations = declarations.replace(/^declare const rhythm: [^\n]+\n/gm, '');
  if (!opnb) declarations = declarations.replace(/^declare const adpcm[AB]: [^\n]+\n/gm, '');
  return declarations;
}
