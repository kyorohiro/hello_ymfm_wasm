const SOURCES = {
  pcm: { key: "pcm", label: "PCM", method: "setPcmMuted" },
  psg: { key: "psg", label: "PSG", method: "setPsgMuted" },
  ssg: { key: "ssg", label: "SSG", method: "setSsgMuted" },
  rhythm: { key: "rhythm", label: "Rhythm", method: "setRhythmMuted" },
  adpcmB: { key: "adpcmB", label: "ADPCM-B", method: "setAdpcmBMuted" },
};
export function sourcesForChip(chip) {
  return (chip === "megacd" ? ["psg", "pcm"] : chip === "ym2608" ? ["ssg", "rhythm", "adpcmB"] : chip === "ym2203" ? ["ssg"] : ["psg"])
    .map((key) => SOURCES[key]);
}
export function applySourceMutes(engine, chip, muted) {
  for (const source of sourcesForChip(chip)) engine[source.method](muted[source.key]);
}
export function allSourcesMuted(chip, channels, muted) {
  return channels.length > 0 && channels.every((channel) => channel.muted) &&
    sourcesForChip(chip).every((source) => muted[source.key]);
}
