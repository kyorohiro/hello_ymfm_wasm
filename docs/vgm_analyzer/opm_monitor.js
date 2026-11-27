// Register decoding follows src/ymfm_opm.h, opm_registers accessors.
// Values describe programmed state, not instantaneous envelopes or audible pitch.
const CHANNEL_FIELDS = [
  [['algorithm',7],['feedback',56],['left',64],['right',128]],
  [['kc',127]], [['kf',252]], [['pms',112],['ams',3]],
];
const OPERATOR_FIELDS = [
  [['dt1',112],['mul',15]], [['tl',127]], [['ks',192],['ar',31]],
  [['am',128],['d1r',31]], [['dt2',192],['d2r',31]], [['d1l',240],['rr',15]],
];

export function createOpmState(now = () => performance.now(), trackChanges = true) {
  const regs = new Uint8Array(256), keys = new Uint8Array(8);
  let amd = 0, pmd = 0;
  const changes = new Map();
  function mark(prefix, before, after, fields) {
    for (const [field, mask] of fields) if ((before & mask) !== (after & mask)) changes.set(`${prefix}.${field}`, now());
  }
  function channel(ch) {
    return {
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
    };
  }
  return {
    channel,
    keyMask(ch) {return keys[ch];},
    globals() {return {lfo:{rate:regs[0x18],waveform:regs[0x1b]&3,amd,pmd}, noise:{enabled:Boolean(regs[15]&128),rate:regs[15]&31}};},
    saveState() { return {regs:regs.slice(),keys:keys.slice(),amd,pmd,changes:new Map(changes)}; },
    loadState(s) { regs.set(s.regs);keys.set(s.keys);amd=s.amd;pmd=s.pmd;changes.clear();for(const [k,v] of s.changes)changes.set(k,v); },
    reset() { regs.fill(0); keys.fill(0); amd = pmd = 0; changes.clear(); },
    opacity(key) { const time = changes.get(key); return time === undefined ? 0 : Math.max(0, 1 - (now() - time) / 1800); },
    hasRecentChanges() { const cutoff=now()-1800;for(const t of changes.values())if(t>cutoff)return true;return false; },
    write(r, v) {
      r &= 255; v &= 255;
      const previous = regs[r];
      if (r !== 8 && r !== 0x19 && previous === v) return;
      if (trackChanges) {
        if (r === 8) {
          for (let slot = 0; slot < 4; slot++) mark(`ch${v & 7}.op${slot}`, keys[v & 7], v >> 3, [['key', 1 << slot]]);
        } else if (r === 0x19) mark('lfo', v & 128 ? pmd : amd, v, [[v & 128 ? 'pmd' : 'amd', 127]]);
        else if (r === 0x18) mark('lfo', previous, v, [['rate',255]]);
        else if (r === 0x1b) mark('lfo', previous, v, [['waveform',3]]);
        else if (r === 15) mark('noise', previous, v, [['enabled',128],['rate',31]]);
        else if (r >= 0x20 && r < 0x40) {
          const fields = CHANNEL_FIELDS[(r-0x20)>>3];
          mark(`ch${r & 7}`, previous, v, fields);
        } else if (r >= 0x40) {
          const fields = OPERATOR_FIELDS[(r-0x40)>>5];
          mark(`ch${r & 7}.op${(r & 31)>>3}`, previous, v, fields);
        }
      }
      if (r === 0x19) { if (v & 128) pmd = v & 127; else amd = v & 127; }
      else if (r !== 0x1a) regs[r] = v;
      if (r === 8) keys[v & 7] = (v >> 3) & 15;
    },
    snapshot() {
      return {
        lfo: {rate: regs[0x18], waveform: regs[0x1b] & 3, amd, pmd},
        noise: {enabled: Boolean(regs[15] & 128), rate: regs[15] & 31},
        channels: Array.from({length:8}, (_, ch) => channel(ch)),
      };
    },
  };
}
export function observeOpmEngine(engine, state, changed) {
  const write = engine.writeYm2151.bind(engine), reset = engine.reset.bind(engine);
  engine.writeYm2151 = (r, v) => { write(r, v); state.write(r, v); changed(); };
  engine.reset = () => { reset(); state.reset(); changed(); };
}
// Keep only the recent bus writes needed to compensate the playback queue.
// Overflow advances the oldest write rather than allocating in the audio loop.
function bufferedWrites(live, display, timing) {
  const capacity = 16384;
  const samples = new Float64Array(capacity);
  const registers = new Uint8Array(capacity);
  const values = new Uint8Array(capacity);
  let head = 0, size = 0;

  function advance() {
    display.write(registers[head], values[head]);
    head = (head + 1) % capacity;
    size--;
  }
  function catchUp() {
    if (!size) return;
    const position = timing.displaySample();
    while (size && samples[head] <= position) advance();
  }
  return {
    ...live,
    write(reg, value) {
      live.write(reg, value);
      if (size === capacity) advance();
      const tail = (head + size) % capacity;
      samples[tail] = timing.writeSample();
      registers[tail] = reg;
      values[tail] = value;
      size++;
    },
    reset() {live.reset(); display.reset(); head = size = 0;},
    loadState(saved) {live.loadState(saved); display.loadState(saved); head = size = 0;},
    hasRecentChanges() {return size > 0 || display.hasRecentChanges();},
    // Seek checkpoints capture the engine head. User exports follow the visible head.
    snapshot() {catchUp(); return display.snapshot();},
    catchUp,
  };
}
export function mountOpmMonitor(root, now, mountEnvelope, timing) {
  const state=createOpmState(now);
  const monitor=timing?bufferedWrites(createOpmState(now,false),state,timing):state;
  const summary = document.createElement('p'); root.append(summary);
  const fields = ['op','key','dt1','dt2','mul','tl','ks','ar','d1r','d2r','d1l','rr','am'];
  const slots=[0,2,1,3],names=['OP1 · M1','OP2 · M2','OP3 · C1','OP4 · C2'];
  const layout = document.createElement('div'); layout.className = 'fm-voice-layout';
  const selector = document.createElement('div'); selector.className = 'fm-channels';
  selector.setAttribute('role','group'); selector.setAttribute('aria-label','Inspect FM channel');
  const detail = document.createElement('section'); detail.className = 'fm-channel-detail';
  layout.append(selector, detail); root.append(layout);
  let selected = 0;
  const buttons = Array.from({length:8}, (_, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'CH' + (i + 1);
    button.onclick = () => {selected = i; render();};
    selector.append(button); return button;
  });
  const envelope = mountEnvelope?.(detail);
  const heading = document.createElement('h4'); detail.append(heading);
  const wrap = document.createElement('div'); wrap.className = 'fm-operator-values';
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const field of fields) {
    const th = document.createElement('th'); th.textContent = field.toUpperCase(); head.append(th);
  }
  table.append(head);
  const rows = Array.from({length:4}, () => {
    const row = document.createElement('tr');
    const cells = fields.map(() => {const cell = document.createElement('td');row.append(cell);return cell;});
    table.append(row);return cells;
  });
  wrap.append(table);detail.append(wrap);
  const channelFields = [['algorithm','Algorithm'],['feedback','Feedback'],['left','L'],['right','R'],['kc','KC'],['kf','KF'],['pms','PMS'],['ams','AMS']];
  const channelTokens = channelFields.map(() => {
    const span = document.createElement('span');span.className = 'param-token';heading.append(span);return span;
  });
  const globalFields = [['lfo.rate','LFO rate'],['lfo.waveform','Wave'],['lfo.amd','AMD'],['lfo.pmd','PMD'],['noise.enabled','CH8 noise'],['noise.rate','Noise rate']];
  const globalTokens = globalFields.map(() => { const span = document.createElement('span');span.className = 'param-token';summary.append(span);return span; });
  function paint(node, key, value, label = '') {
    const text = `${label}${typeof value === 'boolean' ? (value ? 'On' : 'Off') : value}`;
    if(node.textContent!==text)node.textContent=text;
    const field = key.split('.').at(-1);
    const hue = ['dt1','dt2','mul','kc','kf'].includes(field) ? '125 176 255' : field === 'tl' ? '255 224 138' : ['key','am','left','right','enabled'].includes(field) ? '166 214 148' : '255 184 92';
    const opacity = state.opacity(key);
    const background = opacity > 0 ? `color-mix(in srgb, rgba(${hue} / ${Math.max(0.22, opacity * 0.78)}) 75%, rgba(43, 36, 29, 0.06) 25%)` : '';
    if (painted.get(node)!==background) {node.style.background=background;painted.set(node,background);}
  }
  const painted=new WeakMap();
  function render() {
    if (document.hidden || root.closest?.('[hidden]')) return;
    monitor.catchUp?.();
    const data = state.globals();
    globalFields.forEach(([path,label], i) => { const [group,field] = path.split('.'); paint(globalTokens[i],path,data[group][field],`${label} `); });
    buttons.forEach((button,i)=>{
      const pressed=String(i===selected);
      if(button.getAttribute?.('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);
      button.classList.toggle('is-key-on',Boolean(state.keyMask(i)));
    });
    const ch = state.channel(selected);
    envelope?.update(ch);
    channelFields.forEach(([field,label], j) => paint(channelTokens[j],`ch${selected}.${field}`,ch[field],`${label} `));
    slots.forEach((slot,index)=>fields.forEach((field,col)=>{
      const cell=rows[index][col];
      if(field==='op'){if(cell.textContent!==names[index])cell.textContent=names[index];return;}
      const key=field==='key';
      const value=key?Boolean(state.keyMask(selected)&(1<<index)):ch.operators[slot][field];
      if(key)cell.classList.toggle('op-key-on',value);
      paint(cell,`ch${selected}.op${key?index:slot}.${field}`,value);
    }));
  }
  render();return {...monitor,render,dispose() {envelope?.dispose();}};
}
