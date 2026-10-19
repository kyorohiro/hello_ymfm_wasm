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
  if (chip !== 'ym2608') declarations = declarations.replace(
    /^declare const (?:ssg|rhythm|adpcm): PlaygroundYm2608\['(?:ssg|rhythm|adpcm)'\];\n/gm, '');
  return declarations;
}
