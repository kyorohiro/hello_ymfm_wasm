const SOURCES = {
  pwm: { key: "pwm", label: "PWM", method: "setPwmMuted" },
  pcm: { key: "pcm", label: "PCM", method: "setPcmMuted" },
  psg: { key: "psg", label: "PSG", method: "setPsgMuted" },
  ssg: { key: "ssg", label: "SSG", method: "setSsgMuted" },
  rhythm: { key: "rhythm", label: "Rhythm", method: "setRhythmMuted" },
  adpcmB: { key: "adpcmB", label: "ADPCM-B", method: "setAdpcmBMuted" },
  oki: { key: "oki", label: "OKI", method: "setOkiMuted" },
  segapcm: { key: "segapcm", label: "Sega PCM", method: "setSegaPcmMuted" },
};
export function sourcesForChip(chip, hasOki = false) {
  if (chip === 'msx' || chip === 'gameboy' || chip === 'nes') return [];
  if (chip === 'okim6258') return [SOURCES.oki];
  const extra = hasOki ? [SOURCES.oki] : [];
  if (chip === '32x') return [SOURCES.psg, SOURCES.pwm, ...extra];
  if (chip === 'ym2610') return [SOURCES.ssg, {...SOURCES.rhythm, label:'ADPCM-A'}, SOURCES.adpcmB, ...extra];
  return (chip === "megacd" ? ["psg", "pcm"] : chip === "ym2608" ? ["ssg", "rhythm", "adpcmB"] : chip === "ym2203" ? ["ssg"] : chip === "ym2151" ? ["psg", "segapcm"] : ["psg"])
    .map((key) => SOURCES[key]).concat(extra);
}
export function applySourceMutes(engine, chip, muted, hasOki = false) {
  for (const source of sourcesForChip(chip, hasOki)) engine[source.method](muted[source.key]);
}
export function allSourcesMuted(chip, channels, muted, hasOki = false) {
  return channels.length > 0 && channels.every((channel) => channel.muted) &&
    sourcesForChip(chip, hasOki).every((source) => muted[source.key]);
}
