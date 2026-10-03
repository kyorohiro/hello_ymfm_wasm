const SOURCES = {
  oki6295: { key: "oki6295", label: "OKIM6295", method: "setOki6295Muted" },
  pwm: { key: "pwm", label: "PWM", method: "setPwmMuted" },
  pcm: { key: "pcm", label: "PCM", method: "setPcmMuted" },
  psg: { key: "psg", label: "PSG", method: "setPsgMuted" },
  ssg: { key: "ssg", label: "SSG", method: "setSsgMuted" },
  rhythm: { key: "rhythm", label: "Rhythm", method: "setRhythmMuted" },
  adpcmB: { key: "adpcmB", label: "ADPCM-B", method: "setAdpcmBMuted" },
  oki: { key: "oki", label: "OKI", method: "setOkiMuted" },
  segapcm: { key: "segapcm", label: "Sega PCM", method: "setSegaPcmMuted" },
};
export function sourcesForChip(chip, hasOki = false, hasOki6295 = false) {
  if (chip === 'msx' || chip === 'gameboy' || chip === 'nes') return [];
  if (chip === 'huc6280') return hasOki ? [SOURCES.oki] : [];
  if (chip === 'okim6295') return [SOURCES.oki6295, ...(hasOki ? [SOURCES.oki] : [])];
  if (chip === 'okim6258') return [SOURCES.oki];
  const extra = [...(hasOki ? [SOURCES.oki] : []), ...(hasOki6295 ? [SOURCES.oki6295] : [])];
  if (chip === '32x') return [SOURCES.psg, SOURCES.pwm, ...extra];
  if (chip === 'ym2610') return [SOURCES.ssg, {...SOURCES.rhythm, label:'ADPCM-A'}, SOURCES.adpcmB, ...extra];
  return (chip === "megacd" ? ["psg", "pcm"] : chip === "ym2608" ? ["ssg", "rhythm", "adpcmB"] : chip === "ym2203" ? ["ssg"] : chip === "ym2151" ? ["psg", "segapcm"] : ["psg"])
    .map((key) => SOURCES[key]).concat(extra);
}
export function applySourceMutes(engine, chip, muted, hasOki = false, hasOki6295 = false) {
  for (const source of sourcesForChip(chip, hasOki, hasOki6295)) engine[source.method](muted[source.key]);
}
export function allSourcesMuted(chip, channels, muted, hasOki = false, hasOki6295 = false) {
  return channels.length > 0 && channels.every((channel) => channel.muted) &&
    sourcesForChip(chip, hasOki, hasOki6295).every((source) => muted[source.key]);
}
