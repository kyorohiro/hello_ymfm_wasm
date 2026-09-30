/** Exact-write peepholes: never reorder events or group across a wait. */
export function ym2203HighOperation(events, index, registers) {
  const [time, r, v] = events[index];
  const at = offset => events[index + offset]?.[0] === time ? events[index + offset] : null;
  const result = (code, count = 1) => ({code, count});
  const json = JSON.stringify;
  // SSG convenience tone() also writes the mixer and volume: require all four writes.
  if (r <= 4 && r % 2 === 0 && at(1)?.[1] === r + 1 && at(1)[2] <= 15 && at(2)?.[1] === 7 && at(3)?.[1] === 8 + r / 2) {
    const ch = r / 2, volume = at(3)[2];
    const mixer = (registers[7] & ~((1 << ch) | (8 << ch))) | (8 << ch);
    if (at(2)[2] === mixer && volume <= 16) return result(`opn.ssg.tone(${ch}, {period: ${v | at(1)[2] << 8}, volume: ${volume & 15}, envelope: ${volume === 16}});`, 4);
  }
  if (r <= 4 && r % 2 === 0 && at(1)?.[1] === r + 1 && at(1)[2] <= 15)
    return result(`opn.ssg.setTonePeriod(${r / 2}, ${v | at(1)[2] << 8});`, 2);
  if (r === 6 && v <= 31 && at(1)?.[1] === 7 && at(2)?.[1] >= 8 && at(2)?.[1] <= 10 && at(2)[2] <= 16) {
    const ch = at(2)[1] - 8, volume = at(2)[2];
    const mixer = (registers[7] & ~((1 << ch) | (8 << ch))) | (1 << ch);
    if (at(1)[2] === mixer) return result(`opn.ssg.noise(${ch}, {period: ${v}, volume: ${volume & 15}, envelope: ${volume === 16}});`, 3);
  }
  if (r >= 8 && r <= 10 && v <= 16) return result(`opn.ssg.setVolume(${r - 8}, ${v & 15}, ${v === 16});`);
  if (r === 7) {
    for (let ch = 0; ch < 3; ch++) if (((v ^ registers[7]) & ~((1 << ch) | (8 << ch))) === 0)
      return result(`opn.ssg.setMixer(${ch}, {tone: ${!(v & (1 << ch))}, noise: ${!(v & (8 << ch))}});`);
  }
  if (r === 11 && at(1)?.[1] === 12 && at(2)?.[1] === 13 && at(2)[2] <= 15)
    return result(`opn.ssg.setEnvelope({period: ${v | at(1)[2] << 8}, shape: ${at(2)[2]}});`, 3);
  if (r >= 0xa4 && r <= 0xa6 && v <= 63 && at(1)?.[1] === r - 4)
    return result(`opn.setFrequency(${r - 0xa4}, ${v >> 3}, ${(v & 7) << 8 | at(1)[2]});`, 2);
  if (r === 0x28 && (v & 15) <= 2) {
    const ch = v & 3, operators = [0, 1, 2, 3].filter(op => v & (16 << op));
    return result(operators.length ? `opn.keyOn(${ch}, ${json(operators)});` : `opn.keyOff(${ch});`);
  }
  if (r >= 0xb0 && r <= 0xb2 && v <= 63) return result(`opn.setAlgo(${r - 0xb0}, ${v & 7}, ${v >> 3});`);
  if (r >= 0x30 && r <= 0x9e && (r & 3) < 3) {
    const ch = r & 3, op = [0, 2, 1, 3][(r >> 2) & 3];
    const group = r & 0xf0;
    let params;
    if (group === 0x30 && v <= 127) params = {dt: v >> 4, multi: v & 15};
    if (group === 0x40 && v <= 127) params = {tl: v};
    if (group === 0x50 && !(v & 32)) params = {rs: v >> 6, ar: v & 31};
    if (group === 0x60 && !(v & 96)) params = {am: !!(v & 128), d1r: v & 31};
    if (group === 0x70 && v <= 31) params = {d2r: v};
    if (group === 0x80) params = {sl: v >> 4, rr: v & 15};
    if (group === 0x90 && v <= 15) params = {ssg: v};
    if (params) return result(`opn.setOperator(${ch}, ${op}, ${json(params)});`);
  }
  return null;
}
