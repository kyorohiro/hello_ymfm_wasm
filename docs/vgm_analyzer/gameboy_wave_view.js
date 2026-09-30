import {gameboyWaveCode, gameboyWaveJson} from './gameboy_waves.js';

export function appendGameboyWave(output, sample, events) {
  const uses = events.filter(e => e.sampleId === sample.id);
  const row = document.createElement('details'), title = document.createElement('summary');
  title.textContent = `Wave ${sample.id} · Game Boy CH3 · 32 points (0–15) · ${uses.length} observations`;
  row.append(title);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 120; canvas.style.maxWidth = '100%';
  canvas.setAttribute('aria-label', 'Game Boy wave RAM: 32 unsigned 4-bit values');
  let drawn = false;
  row.addEventListener('toggle', () => {
    if (!row.open || drawn) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawn = true; ctx.strokeStyle = '#44aacc'; ctx.beginPath();
    sample.waveform.forEach((value, i) => {
      const x = i * 16, y = 112 - value * 7;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      ctx.lineTo(x + 16, y);
    });
    ctx.stroke();
  });
  const code = document.createElement('textarea');
  code.readOnly = true; code.rows = 4; code.style.width = '100%';
  code.setAttribute('aria-label', 'Game Boy setWaveform JavaScript');
  code.value = gameboyWaveCode(sample);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const copy = document.createElement('button'); copy.textContent = 'Copy setWaveform JavaScript';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(code.value); status.textContent = 'Copied.'; }
    catch { code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.'; }
  };
  const save = document.createElement('button'); save.textContent = 'Save waveform JSON';
  save.onclick = () => {
    const url = URL.createObjectURL(new Blob([gameboyWaveJson(sample, events)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `gameboy-wave-${sample.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const help = document.createElement('p');
  help.textContent = 'Use with a Game Boy chip named gb. setWaveform stops the wave channel; set the note and level, then call keyOn() to play. Observations below are register writes, not detected audible notes.';
  const history = document.createElement('pre');
  history.textContent = uses.slice(0, 500).map(e => `${(e.startTime / 44100).toFixed(3)} s · chip ${e.chipIndex + 1} · ${e.reason}`).join('\n');
  if (uses.length > 500) history.textContent += '\nShowing first 500 observations.';
  row.append(canvas, code, copy, save, status, help, history);
  output.append(row);
}
