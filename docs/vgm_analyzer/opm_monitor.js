// Register decoding follows src/ymfm_opm.h, opm_registers accessors.
// Values describe programmed state, not instantaneous envelopes or audible pitch.
export function createOpmState(now = () => performance.now()) {
  const regs = new Uint8Array(256), keys = new Uint8Array(8);
  let amd = 0, pmd = 0;
  const changes = new Map();
  function mark(prefix, before, after, fields) {
    for (const [field, mask] of fields) if ((before & mask) !== (after & mask)) changes.set(`${prefix}.${field}`, now());
  }
  return {
    reset() { regs.fill(0); keys.fill(0); amd = pmd = 0; changes.clear(); },
    opacity(key) { const time = changes.get(key); return time === undefined ? 0 : Math.max(0, 1 - (now() - time) / 1800); },
    hasRecentChanges() { return [...changes.values()].some(time => now() - time < 1800); },
    write(r, v) {
      r &= 255; v &= 255;
      const previous = regs[r];
      if (r === 8) {
        for (let slot = 0; slot < 4; slot++) mark(`ch${v & 7}.op${slot}`, keys[v & 7], v >> 3, [['key', 1 << slot]]);
      } else if (r === 0x19) mark('lfo', v & 128 ? pmd : amd, v, [[v & 128 ? 'pmd' : 'amd', 127]]);
      else if (r === 0x18) mark('lfo', previous, v, [['rate',255]]);
      else if (r === 0x1b) mark('lfo', previous, v, [['waveform',3]]);
      else if (r === 15) mark('noise', previous, v, [['enabled',128],['rate',31]]);
      else if (r >= 0x20 && r < 0x40) {
        const fields = [[['algorithm',7],['feedback',56],['left',64],['right',128]], [['kc',127]], [['kf',252]], [['pms',112],['ams',3]]][(r-0x20)>>3];
        mark(`ch${r & 7}`, previous, v, fields);
      } else if (r >= 0x40) {
        const fields = [[['dt1',112],['mul',15]], [['tl',127]], [['ks',192],['ar',31]], [['am',128],['d1r',31]], [['dt2',192],['d2r',31]], [['d1l',240],['rr',15]]][(r-0x40)>>5];
        mark(`ch${r & 7}.op${(r & 31)>>3}`, previous, v, fields);
      }
      if (r === 0x19) { if (v & 128) pmd = v & 127; else amd = v & 127; }
      else if (r !== 0x1a) regs[r] = v;
      if (r === 8) keys[v & 7] = (v >> 3) & 15;
    },
    snapshot() {
      return {
        lfo: {rate: regs[0x18], waveform: regs[0x1b] & 3, amd, pmd},
        noise: {enabled: Boolean(regs[15] & 128), rate: regs[15] & 31},
        channels: Array.from({length:8}, (_, ch) => ({
          channel: ch + 1, algorithm: regs[0x20+ch] & 7, feedback: (regs[0x20+ch] >> 3) & 7,
          left: Boolean(regs[0x20+ch] & 64), right: Boolean(regs[0x20+ch] & 128),
          kc: regs[0x28+ch] & 127, kf: regs[0x30+ch] >> 2,
          pms: (regs[0x38+ch] >> 4) & 7, ams: regs[0x38+ch] & 3,
          // Display register slots explicitly; algorithm wiring uses order 0,2,1,3.
          operators: Array.from({length:4}, (_, slot) => {
            const offset = ch + slot * 8;
            return {slot: slot + 1, key: Boolean(keys[ch] & (1 << slot)),
              dt1: (regs[0x40+offset] >> 4) & 7, mul: regs[0x40+offset] & 15,
              tl: regs[0x60+offset] & 127, ks: regs[0x80+offset] >> 6, ar: regs[0x80+offset] & 31,
              am: regs[0xa0+offset] >> 7, d1r: regs[0xa0+offset] & 31,
              dt2: regs[0xc0+offset] >> 6, d2r: regs[0xc0+offset] & 31,
              d1l: regs[0xe0+offset] >> 4, rr: regs[0xe0+offset] & 15};
          }),
        })),
      };
    },
  };
}
export function observeOpmEngine(engine, state, changed) {
  const write = engine.writeYm2151.bind(engine), reset = engine.reset.bind(engine);
  engine.writeYm2151 = (r, v) => { write(r, v); state.write(r, v); changed(); };
  engine.reset = () => { reset(); state.reset(); changed(); };
}
export function mountOpmMonitor(root, now) {
  const state = createOpmState(now);
  const title = document.createElement('h3'); title.textContent = 'YM2151 Operator Info'; root.append(title);
  const note = document.createElement('p');
  note.textContent = 'Playback register state (may lead audible output by the audio queue). Key shows the last key command, not envelope activity. Raw register values; TFI export is not applicable. Slots follow register offsets +00/+08/+10/+18; algorithm order is 1/3/2/4.';
  root.append(note);
  const summary = document.createElement('p'); root.append(summary);
  const fields = ['slot','key','dt1','mul','tl','ks','ar','am','d1r','dt2','d2r','d1l','rr'];
  const cards = Array.from({length:8}, () => {
    const section = document.createElement('section'), heading = document.createElement('h4');section.append(heading);
    const wrap = document.createElement('div');wrap.style.overflowX = 'auto';
    const table = document.createElement('table'), head = document.createElement('tr');
    for (const field of fields) { const th = document.createElement('th'); th.textContent = field.toUpperCase(); head.append(th); } table.append(head);
    const rows = Array.from({length:4}, () => { const row = document.createElement('tr'); const cells = fields.map(() => {const cell = document.createElement('td');row.append(cell);return cell;});table.append(row);return cells;});
    wrap.append(table);section.append(wrap);root.append(section);return {heading,rows};
  });
  const channelFields = [['algorithm','ALG'],['feedback','FB'],['left','L'],['right','R'],['kc','KC'],['kf','KF'],['pms','PMS'],['ams','AMS']];
  const channelTokens = cards.map(({heading}, i) => {
    heading.textContent = `CH${i+1} · `;
    return channelFields.map(() => { const span = document.createElement('span');span.className = 'param-token';heading.append(span);return span; });
  });
  const globalFields = [['lfo.rate','LFO rate'],['lfo.waveform','Wave'],['lfo.amd','AMD'],['lfo.pmd','PMD'],['noise.enabled','CH8 noise'],['noise.rate','Noise rate']];
  const globalTokens = globalFields.map(() => { const span = document.createElement('span');span.className = 'param-token';summary.append(span);return span; });
  function paint(node, key, value, label = '') {
    node.textContent = `${label}${typeof value === 'boolean' ? (value ? 'On' : 'Off') : value}`;
    const field = key.split('.').at(-1);
    const hue = ['dt1','dt2','mul','kc','kf'].includes(field) ? '125 176 255' : field === 'tl' ? '255 224 138' : ['key','am','left','right','enabled'].includes(field) ? '166 214 148' : '255 184 92';
    const opacity = state.opacity(key);
    node.style.background = opacity > 0 ? `color-mix(in srgb, rgba(${hue} / ${Math.max(0.22, opacity * 0.78)}) 75%, rgba(43, 36, 29, 0.06) 25%)` : '';
  }
  function render() {
    const data = state.snapshot();
    globalFields.forEach(([path,label], i) => { const [group,field] = path.split('.'); paint(globalTokens[i],path,data[group][field],`${label} `); });
    data.channels.forEach((ch, i) => {
      channelFields.forEach(([field,label], j) => paint(channelTokens[i][j],`ch${i}.${field}`,ch[field],`${label} `));
      ch.operators.forEach((op, slot) => fields.forEach((key, col) => paint(cards[i].rows[slot][col],`ch${i}.op${slot}.${key}`,op[key])));
    });
  }
  render();return {...state,render};
}
