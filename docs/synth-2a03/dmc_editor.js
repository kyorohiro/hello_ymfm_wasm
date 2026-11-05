// SPDX-License-Identifier: BSD-3-Clause
import {decodeDpcm} from './dmc_decode.js';
import {applyDmcTargets} from './dmc_draw.js';
import {fitDmcTargets} from './dmc_fit.js';
import {createDmcHistory} from './dmc_history.js';

const PAGE_BYTES = 4;
const equalBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const hex = (value, digits = 2) => value.toString(16).toUpperCase().padStart(digits, '0');

/** Software view of encoded bits and unfiltered DAC steps. Owns no audio. */
export function createDmcBitEditor({root, onChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis, cleanups = [];
  let dmc = {data:[], level:64, rate:15, loop:false}, decoded = decodeDpcm([]);
  let page = 0, selectedBit = 0, whole = false, disposed = false;
  let stroke = null, lastTargets = null, lastFit = null, previewFrame = 0, autoFit = false;
  const history = createDmcHistory();
  const make = (tag, className, text) => {
    const node = doc.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  };
  const listen = (node, type, callback) => {node.addEventListener(type, callback); cleanups.push(() => node.removeEventListener(type, callback));};
  const section = make('section', 'nes-dmc-editor nes-subsection'); section.id = 'dmcBitEditor';
  section.tabIndex = -1;
  section.setAttribute('aria-labelledby', 'dmcEditorTitle');
  const title = make('h4', '', 'DMC Editor · draw / bits → DAC'); title.id = 'dmcEditorTitle'; section.append(title);
  const explanation = make('p', 'nes-help', 'Playback order: b0 → b7 (LSB first). 1 raises the DAC by 2; 0 lowers it by 2. At a boundary the level holds. Even starts stay even (0–126); odd starts stay odd (1–127). Click a bit to change it.');
  section.append(explanation);
  const modes = make('div', 'nes-wave-actions'); section.append(modes);
  function button(parent, id, text, callback) {
    const node = make('button', '', text); node.type = 'button'; node.id = id;
    listen(node, 'pointerdown', event => {if (event.button === 0) {event.preventDefault(); doc.activeElement?.blur();}});
    listen(node, 'click', event => {if (event.detail) node.blur(); callback();});
    parent.append(node); return node;
  }
  const selectedMode = button(modes, 'dmcWaveSelected', 'Selected bytes', () => {cancelDrawing(); whole = false; renderWave();});
  const allMode = button(modes, 'dmcWaveAll', 'All data', () => {cancelDrawing(); whole = true; renderWave();});
  const undo = button(modes, 'dmcUndo', 'Undo', () => restoreHistory('undo'));
  const redo = button(modes, 'dmcRedo', 'Redo', () => restoreHistory('redo'));
  undo.title = 'Undo one bit edit or completed drawing. With editor focus: Ctrl / Cmd + Z.';
  redo.title = 'Redo an edit. With editor focus: Shift + Ctrl / Cmd + Z, or Ctrl + Y.';
  const historyStatus = make('output', 'nes-help'); historyStatus.id = 'dmcHistoryStatus'; modes.append(historyStatus);
  const fitRow = make('label', 'nes-field nes-check');
  const fitCheck = make('input'); fitCheck.type = 'checkbox'; fitCheck.id = 'dmcAutoFit';
  fitRow.append(fitCheck, doc.createTextNode('Auto fit height · adjust nearby bits')); section.append(fitRow);
  const fitHelp = make('p', 'nes-help', 'Off: change only the bits you touch. On: also adjust up to 62 earlier and 63 later bits, including outside Selected bytes, to follow the drawn shape and return to the original wave when possible. Initial level stays fixed. A one-step height difference is allowed to keep the curve close to your drawing. Undo restores the whole edit.');
  fitHelp.id = 'dmcAutoFitHelp'; fitCheck.setAttribute('aria-describedby', fitHelp.id); section.append(fitHelp);
  let fitPointer = false;
  listen(fitRow, 'pointerdown', () => {fitPointer = true;});
  listen(fitCheck, 'keydown', () => {fitPointer = false;});
  listen(fitCheck, 'change', () => {
    cancelDrawing(); autoFit = fitCheck.checked; lastTargets = null; lastFit = null;
    drawingStatus.textContent = autoFit ? 'Auto fit height on · draw a target; nearby bits may change. Release to apply, Escape to cancel.' : drawingHint;
    if (fitPointer) {doc.activeElement?.blur(); fitPointer = false;}
    renderWave();
  });
  const canvas = make('canvas'); canvas.id = 'dmcDacCanvas'; canvas.width = 900; canvas.height = 220;
  canvas.setAttribute('role', 'img'); section.append(canvas);
  canvas.title = 'Draw a target curve. DMC chooses up / down bits within its hardware limits. Release to apply; Escape cancels.';
  const drawingHint = 'Draw on the graph to set target DAC levels. Release to apply, Escape to cancel. This is a software drawing aid, not audio-file conversion.';
  const drawingStatus = make('p', 'nes-help nes-dmc-drawing-status', drawingHint);
  drawingStatus.id = 'dmcDrawingStatus'; drawingStatus.setAttribute('role', 'status'); section.append(drawingStatus);
  const summary = make('p', 'nes-wave-readout'); summary.id = 'dmcDacSummary'; summary.setAttribute('aria-live', 'polite'); section.append(summary);
  const legend = make('p', 'nes-help nes-dmc-legend'); section.append(legend);
  const navigation = make('div', 'nes-dmc-navigation'); section.append(navigation);
  const pageLabel = make('output'); pageLabel.id = 'dmcBitsPage'; pageLabel.setAttribute('aria-live', 'polite'); navigation.append(pageLabel);
  const first = button(navigation, 'dmcBitsFirst', 'First', () => go(0));
  const previous = button(navigation, 'dmcBitsPrevious', 'Previous', () => go(page - 1));
  const next = button(navigation, 'dmcBitsNext', 'Next', () => go(page + 1));
  const last = button(navigation, 'dmcBitsLast', 'Last', () => go(pages() - 1));
  const grid = make('div', 'nes-dmc-bit-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'DPCM bits in playback order'); section.append(grid);
  const bitReadout = make('p', 'nes-help nes-dmc-bit-readout'); bitReadout.id = 'dmcBitReadout'; bitReadout.setAttribute('role', 'status'); section.append(bitReadout);
  const instructions = make('p', 'nes-help', 'With a bit focused: Space / Enter toggles, 0 / 1 sets it, arrows move, Home / End jumps. With editor focus: Ctrl / Cmd + Z undoes, Shift + Ctrl / Cmd + Z or Ctrl + Y redoes. Pointer edits return to the performance keyboard. Data edits stop held notes; play a new key to hear them.'); section.append(instructions);
  root.append(section);

  function renderHistory() {
    const state = history.read(), focused = doc.activeElement;
    undo.disabled = !state.canUndo; redo.disabled = !state.canRedo;
    section.dataset.undoCount = String(state.undoCount); section.dataset.redoCount = String(state.redoCount);
    historyStatus.textContent = `Undo ${state.undoCount} · Redo ${state.redoCount}`;
    // Keep keyboard users inside the editor if their action disables its button.
    if ((focused === undo || focused === redo) && focused.disabled) section.focus({preventScroll:true});
  }
  function restoreHistory(direction) {
    if (disposed) return;
    cancelDrawing();
    const data = history[direction]();
    if (!data) return;
    const previous = dmc;
    try {
      lastTargets = null; lastFit = null;
      dmc = {...dmc,data}; decoded = decodeDpcm(data,dmc); render();
      drawingStatus.textContent = `${direction === 'undo' ? 'Undo' : 'Redo'} applied · current Rate, Loop and Initial level kept. Play a new key to hear it.`;
      Promise.resolve(onChange([...data])).catch(onError);
    } catch (error) {
      history[direction === 'undo' ? 'redo' : 'undo']();
      dmc = previous; decoded = decodeDpcm(dmc.data,dmc); render(); onError(error);
    }
  }
  listen(section,'keydown',event => {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || section.closest('[hidden]')) return;
    if (event.target.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const key = event.key.toLowerCase();
    const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey ? 'redo' : null;
    if (!direction || !history.read()[direction === 'undo' ? 'canUndo' : 'canRedo']) return;
    event.preventDefault(); event.stopPropagation(); restoreHistory(direction);
  });
  function pages() {return Math.max(1, Math.ceil(decoded.hardwareBytes / PAGE_BYTES));}
  function go(value, focusBit = false) {
    cancelDrawing();
    page = Math.max(0, Math.min(pages() - 1, value)); selectedBit = page * PAGE_BYTES * 8;
    render(); if (focusBit) findBit(selectedBit)?.focus({preventScroll:true});
  }
  function findBit(index) {return grid.querySelector(`[data-dmc-byte="${index >> 3}"][data-dmc-bit="${index & 7}"]`);}
  function inspectBit(index) {
    selectedBit = index;
    for (const node of grid.querySelectorAll('[data-dmc-byte][data-dmc-bit]')) node.classList.toggle('is-inspected',Number(node.dataset.dmcByte)*8+Number(node.dataset.dmcBit) === index);
    renderReadout(); draw();
  }
  function edit(index, bit) {
    if (disposed || index < 0 || index >= dmc.data.length * 8) return;
    cancelDrawing(); lastTargets = null; lastFit = null; drawingStatus.textContent = drawingHint;
    const data = [...dmc.data], byte = index >> 3, mask = 1 << (index & 7);
    data[byte] = bit ? data[byte] | mask : data[byte] & ~mask;
    selectedBit = index;
    if (equalBytes(data, dmc.data)) {renderWave(); return;}
    const old = dmc;
    try {
      dmc = {...dmc, data}; decoded = decodeDpcm(data, dmc); render();
      const result = onChange([...data]);
      history.push(data); renderHistory();
      Promise.resolve(result).catch(onError);
    } catch (error) {dmc = old; decoded = decodeDpcm(old.data, old); render(); onError(error);}
  }
  listen(grid, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target.closest?.('[data-dmc-byte][data-dmc-bit]');
    if (!target || target.disabled || !grid.contains(target)) return;
    const index = Number(target.dataset.dmcByte) * 8 + Number(target.dataset.dmcBit);
    let move;
    if (event.key === '0' || event.key === '1') {
      event.preventDefault(); event.stopPropagation(); edit(index, Number(event.key)); return;
    }
    if (event.key === 'ArrowLeft') move = index - 1;
    else if (event.key === 'ArrowRight') move = index + 1;
    else if (event.key === 'ArrowUp') move = index - 8;
    else if (event.key === 'ArrowDown') move = index + 8;
    else if (event.key === 'PageUp') move = index - PAGE_BYTES * 8;
    else if (event.key === 'PageDown') move = index + PAGE_BYTES * 8;
    else if (event.key === 'Home') move = 0;
    else if (event.key === 'End') move = dmc.data.length * 8 - 1;
    else return;
    event.preventDefault(); event.stopPropagation();
    cancelDrawing();
    move = Math.max(0, Math.min(dmc.data.length * 8 - 1, move));
    page = Math.floor(move / (PAGE_BYTES * 8)); selectedBit = move; render(); findBit(move)?.focus({preventScroll:true});
  });
  function renderBits() {
    const focused = doc.activeElement;
    const focusIndex = grid.contains(focused) && focused?.matches?.('[data-dmc-byte][data-dmc-bit]')
      ? Number(focused.dataset.dmcByte) * 8 + Number(focused.dataset.dmcBit) : null;
    const start = page * PAGE_BYTES, end = Math.min(decoded.hardwareBytes, start + PAGE_BYTES), rows = [];
    for (let byte = start; byte < end; byte++) {
      const padding = byte >= dmc.data.length, row = make('div', 'nes-dmc-byte');
      row.dataset.padding = String(padding);
      row.append(make('span', 'nes-dmc-byte-label', `Byte ${byte} · $${hex(byte,4)} · 0x${hex(decoded.paddedData[byte])}${padding ? ' · generated padding' : ''}`));
      const bits = make('div', 'nes-dmc-bits'); row.append(bits);
      for (let bit = 0; bit < 8; bit++) {
        const index = byte * 8 + bit, value = (decoded.paddedData[byte] >> bit) & 1;
        const node = make('button', 'nes-dmc-bit'); node.type = 'button'; node.dataset.dmcByte = String(byte); node.dataset.dmcBit = String(bit); node.dataset.dmcPadding = String(padding);
        node.disabled = padding; node.setAttribute('aria-pressed', String(Boolean(value)));
        node.classList.toggle('is-inspected',index === selectedBit);
        const from = decoded.levels[index], to = decoded.levels[index + 1];
        const label = `Byte ${byte}, b${bit}, ${value}: DAC ${from} to ${to}${from === to ? ', held at boundary' : ''}${padding ? ', generated padding, read only' : ''}`;
        node.setAttribute('aria-label', label); node.title = label;
        node.append(make('small', '', `b${bit}`), make('span', '', String(value)));
        // Row-local listeners disappear with the row; don't retain old nodes
        // in the component's lifecycle cleanup list.
        node.addEventListener('pointerdown', event => {if (event.button === 0) {event.preventDefault(); doc.activeElement?.blur();}});
        node.addEventListener('click', event => {if (event.detail) node.blur(); edit(index, value ^ 1);});
        node.addEventListener('focus', () => inspectBit(index));
        bits.append(node);
      }
      rows.push(row);
    }
    grid.replaceChildren(...rows);
    if (focusIndex !== null) findBit(focusIndex)?.focus({preventScroll:true});
  }
  function renderReadout() {
    if (!decoded.hardwareBytes) {bitReadout.textContent = 'Load DPCM or choose Demo sample to inspect bits.'; return;}
    const index = Math.min(decoded.levels.length - 2, selectedBit), byte = index >> 3, bit = index & 7;
    const value = (decoded.paddedData[byte] >> bit) & 1, from = decoded.levels[index], to = decoded.levels[index + 1];
    bitReadout.textContent = `Byte ${byte} · b${bit} · ${value} (${value ? '+2' : '−2'}) · DAC ${from} → ${to}${from === to ? ' · held at boundary' : ''}${byte >= dmc.data.length ? ' · generated 0xAA padding, read only' : ''}`;
  }
  function visibleRange() {
    const total = decoded.hardwareBytes * 8, start = whole ? 0 : page * PAGE_BYTES * 8;
    return {start, count:whole ? total : Math.min(PAGE_BYTES * 8,total - start)};
  }
  function drawingPoint(event) {
    const rect = canvas.getBoundingClientRect(), {start,count} = visibleRange();
    const px = (event.clientX - rect.left) / rect.width * canvas.width;
    const py = (event.clientY - rect.top) / rect.height * canvas.height;
    // A target describes the DAC AFTER a bit: snap to the nearest step
    // endpoint, while the configured initial level remains the starting anchor.
    const position = start + Math.max(0,Math.min(count,(px - 32) / (canvas.width - 46) * count));
    const offset = Math.max(0,Math.min(count - 1,Math.round(position - start) - 1));
    const padding = decoded.paddingBytes > 0 && position >= dmc.data.length * 8;
    return {bit:padding ? Math.max(dmc.data.length * 8,start + offset) : start + offset,
      level:Math.max(0,Math.min(127,(canvas.height - 30 - py) / (canvas.height - 48) * 127)),padding};
  }
  function targetEntries(targets) {return [...targets].map(([bit,level]) => ({bit,level}));}
  function fitStatus(fit, applied = false) {
    const cursor = fit.cursor;
    return `Auto fit ${applied ? 'applied' : 'preview'} · target ${cursor.target.toFixed(1)} → DAC ${cursor.actual} (error ${cursor.error.toFixed(1)}) · ${fit.changedBefore} earlier / ${fit.changedAfter} later bits changed outside the drawn range. ${fit.rejoined ? 'Returned to the original wave.' : 'End differs from the original wave; later decoded levels may shift.'} ${applied ? 'Play a new key to hear it; Undo restores all changed bits.' : 'Current sound is kept until release. Escape cancels.'}`;
  }
  function cancelPreviewFrame() {
    if (previewFrame) {win.cancelAnimationFrame(previewFrame); previewFrame = 0;}
  }
  function calculatePreview() {
    cancelPreviewFrame();
    if (!stroke) return;
    if (!canvas.clientWidth || !canvas.clientHeight || canvas.closest('details:not([open])') || section.closest('[hidden]')) {cancelDrawing(); return;}
    try {
      if (autoFit) {
        stroke.fit = fitDmcTargets(stroke.baseData, targetEntries(stroke.targets), {level:dmc.level, priorityBit:stroke.priorityBit});
        stroke.preview = stroke.fit.data;
      } else stroke.preview = applyDmcTargets(stroke.baseData,targetEntries(stroke.targets),{level:dmc.level});
      decoded = decodeDpcm(stroke.preview,dmc);
      drawingStatus.textContent = autoFit ? fitStatus(stroke.fit) : 'Drawing preview · green is the target, blue is decoded DMC. Current sound is kept until release. Escape cancels.';
      render();
    } catch (error) {cancelDrawing(); onError(error);}
  }
  function previewStroke(event, immediate = false) {
    if (!stroke || stroke.id !== event.pointerId) return;
    const point = drawingPoint(event), from = stroke.previous, distance = Math.abs(point.bit - from.bit);
    for (let step = 0; step <= distance; step++) {
      const ratio = distance ? step / distance : 1, bit = Math.round(from.bit + (point.bit - from.bit) * ratio);
      if (bit < dmc.data.length * 8) stroke.targets.set(bit,from.level + (point.level - from.level) * ratio);
    }
    stroke.previous = point;
    stroke.priorityBit = Math.min(dmc.data.length * 8 - 1, point.bit);
    selectedBit = Math.max(page * PAGE_BYTES * 8,Math.min(page * PAGE_BYTES * 8 + PAGE_BYTES * 8 - 1,point.bit));
    if (immediate || !autoFit) calculatePreview();
    else if (!previewFrame) previewFrame = win.requestAnimationFrame(() => {previewFrame = 0; calculatePreview();});
  }
  function cancelDrawing(event) {
    if (!stroke || event?.pointerId !== undefined && event.pointerId !== stroke.id) return;
    cancelPreviewFrame();
    const id = stroke.id; stroke = null; lastFit = null; decoded = decodeDpcm(dmc.data,dmc);
    if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    drawingStatus.textContent = 'Drawing cancelled · previous DPCM data kept.';
    render();
  }
  listen(canvas,'pointerdown',event => {
    if (event.button !== 0 || stroke || !dmc.data.length || !canvas.clientWidth || !canvas.clientHeight || canvas.closest('details:not([open])')) return;
    resize();
    const point = drawingPoint(event);
    if (point.padding) {drawingStatus.textContent = 'Generated padding is read only. Draw over the original sample bytes.'; return;}
    event.preventDefault(); doc.activeElement?.blur();
    stroke = {id:event.pointerId,baseData:[...dmc.data],targets:new Map(),previous:point,preview:[...dmc.data]};
    canvas.setPointerCapture(event.pointerId); previewStroke(event, true);
  });
  listen(canvas,'pointermove',event => {if (stroke?.id === event.pointerId) {
    if (!canvas.clientWidth || !canvas.clientHeight || canvas.closest('details:not([open])')) {cancelDrawing();return;}
    event.preventDefault(); previewStroke(event);
  }});
  listen(canvas,'pointerup',event => {
    if (!stroke || stroke.id !== event.pointerId) return;
    if (!canvas.clientWidth || !canvas.clientHeight || canvas.closest('details:not([open])')) {cancelDrawing();return;}
    previewStroke(event, true);
    if (!stroke || stroke.id !== event.pointerId) return;
    const data = stroke.preview, targets = targetEntries(stroke.targets), fit = stroke.fit, id = stroke.id, previous = dmc;
    stroke = null; lastTargets = targets; lastFit = fit ?? null;
    if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    try {
      const changed = !equalBytes(data,dmc.data);
      dmc = {...dmc,data}; decoded = decodeDpcm(data,dmc); render();
      drawingStatus.textContent = fit ? fitStatus(fit, true) : changed ? 'Drawing applied · DMC approximates the green target with up / down bits. Play a new key to hear it.' : 'Drawing kept the same bits · the green target shows the requested levels.';
      if (changed) {
        const result = onChange([...data]);
        history.push(data); renderHistory();
        Promise.resolve(result).catch(onError);
      }
    } catch (error) {dmc = previous; lastTargets = null; lastFit = null; decoded = decodeDpcm(dmc.data,dmc); render(); onError(error);}
  });
  listen(canvas,'pointercancel',cancelDrawing); listen(canvas,'lostpointercapture',cancelDrawing);
  listen(win,'blur',() => cancelDrawing());
  listen(doc,'visibilitychange',() => {if (doc.hidden) cancelDrawing();});
  listen(win,'keydown',event => {if (stroke && event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancelDrawing();}});
  function draw() {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const width = canvas.width, height = canvas.height, left = 32, right = width - 14, top = 18, bottom = height - 30;
    const total = decoded.hardwareBytes * 8, start = whole ? 0 : page * PAGE_BYTES * 8;
    const count = whole ? total : Math.min(PAGE_BYTES * 8, total - start);
    const x = index => left + index / Math.max(1,count) * (right - left), y = value => bottom - value / 127 * (bottom - top);
    ctx.fillStyle = '#202831'; ctx.fillRect(0,0,width,height); ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
    for (const level of [0,64,127]) {
      ctx.strokeStyle = '#405365'; ctx.beginPath(); ctx.moveTo(left,y(level)); ctx.lineTo(right,y(level)); ctx.stroke();
      ctx.fillStyle = '#cbd9e7'; ctx.fillText(String(level),3,y(level) + 4);
    }
    if (count) {
      const marked = whole ? page * PAGE_BYTES * 8 : selectedBit;
      const markedEnd = whole ? Math.min(total, marked + PAGE_BYTES * 8) : marked + 1;
      ctx.fillStyle = '#85bedf1c'; ctx.fillRect(x(marked - start),top,Math.max(1,x(markedEnd - start) - x(marked - start)),bottom - top);
      if (count <= 32) for (let bit = 0; bit <= count; bit += 8) {
        ctx.strokeStyle = '#526471'; ctx.beginPath(); ctx.moveTo(x(bit),top); ctx.lineTo(x(bit),bottom); ctx.stroke();
      }
      function trace(levels, color, dashed = false) {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [5,3] : []); ctx.beginPath();
        if (count <= right - left) {
          ctx.moveTo(x(0),y(levels[start]));
          for (let bit = 0; bit < count; bit++) {ctx.lineTo(x(bit + 1),y(levels[start + bit])); ctx.lineTo(x(bit + 1),y(levels[start + bit + 1]));}
        } else {
          // Min/max per pixel keeps single-bit excursions visible without
          // drawing tens of thousands of segments on a narrow overview.
          const columns = Math.floor(right - left);
          for (let column = 0; column < columns; column++) {
            const low = start + Math.floor(column * count / columns), high = start + Math.floor((column + 1) * count / columns);
            let min = 127, max = 0;
            for (let bit = low; bit <= high; bit++) {min = Math.min(min,levels[bit]); max = Math.max(max,levels[bit]);}
            const px = left + column; ctx.moveTo(px,y(min)); ctx.lineTo(px,y(max));
          }
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
      trace(decoded.levels,'#85bedf');
      if (decoded.nextLevels) trace(decoded.nextLevels,'#e4b078',true);
      const targets = stroke ? targetEntries(stroke.targets) : lastTargets;
      if (targets?.length) {
        const visible = targets.filter(point => point.bit >= start && point.bit < start + count).sort((a,b) => a.bit - b.bit);
        ctx.strokeStyle = '#a0dfa5'; ctx.fillStyle = '#a0dfa5'; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let index = 0; index < visible.length; index++) {
          const point = visible[index], px = x(point.bit + 1 - start), py = y(point.level);
          if (!index) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.stroke();
        if (visible.length === 1) {ctx.beginPath(); ctx.arc(x(visible[0].bit + 1 - start),y(visible[0].level),3,0,2*Math.PI); ctx.fill();}
      }
      const pad = dmc.data.length * 8;
      if (pad < start + count && total > pad) {
        ctx.fillStyle = '#a8afb82b'; ctx.fillRect(x(Math.max(0,pad-start)),top,right - x(Math.max(0,pad-start)),bottom - top);
      }
    } else {ctx.fillStyle = '#cbd9e7'; ctx.fillText('No DPCM data',left,top + 26);}
    ctx.fillStyle = '#cbd9e7';
    ctx.fillText(`${(start * decoded.bitDurationMs).toFixed(2)} ms`,left,height - 9);
    const endLabel = `${((start + Math.max(0,count)) * decoded.bitDurationMs).toFixed(2)} ms`;
    ctx.fillText(endLabel,Math.max(left,right - ctx.measureText(endLabel).width),height - 9);
  }
  function renderWave() {
    selectedMode.setAttribute('aria-pressed', String(!whole)); allMode.setAttribute('aria-pressed', String(whole));
    const fit = stroke ? stroke.fit : lastFit;
    Object.assign(canvas.dataset, {startLevel:String(dmc.level),endLevel:String(decoded.levels.at(-1)),bitCount:String(decoded.hardwareBytes * 8),durationMs:String(decoded.durationMs),
      nextStartLevel:decoded.nextLevels ? String(decoded.nextLevels[0]) : '',nextEndLevel:decoded.nextLevels ? String(decoded.nextLevels.at(-1)) : '',
      visibleStartBit:String(whole ? 0 : page * PAGE_BYTES * 8),visibleBits:String(whole ? decoded.hardwareBytes * 8 : Math.min(PAGE_BYTES,decoded.hardwareBytes-page*PAGE_BYTES)*8),
      drawing:String(Boolean(stroke)),targetPoints:String(stroke ? stroke.targets.size : lastTargets?.length ?? 0),editable:String(Boolean(dmc.data.length)),
      autoFit:String(autoFit),fitActual:fit?.cursor ? String(fit.cursor.actual) : '',fitTarget:fit?.cursor ? String(fit.cursor.target) : '',fitError:fit?.cursor ? String(fit.cursor.error) : '',
      fitBefore:fit ? String(fit.changedBefore) : '',fitAfter:fit ? String(fit.changedAfter) : ''});
    canvas.setAttribute('aria-label', `Draw DMC target levels, 0 to 127, ${whole ? 'all data' : 'selected bytes'}, initial ${dmc.level}, decoded end ${decoded.levels.at(-1)}${dmc.loop ? ', second loop continues from the previous end' : ''}`);
    summary.textContent = decoded.hardwareBytes
      ? `Whole pass: DAC ${dmc.level} → ${decoded.levels.at(-1)} · ${decoded.clipped} boundary holds${decoded.nextLevels ? ` · Next pass ${decoded.nextLevels[0]} → ${decoded.nextLevels.at(-1)} (${decoded.nextClipped} holds)` : ''}`
      : `No data · Initial DAC ${dmc.level}`;
    legend.textContent = `Blue: decoded first pass${stroke || lastTargets?.length ? ' · Green: drawn target (DMC may not reach it)' : ''}${dmc.loop ? ' · Amber dashed: next pass, without resetting the DAC' : ''}${decoded.paddingBytes ? ` · Grey: ${decoded.paddingBytes} generated 0xAA padding ${decoded.paddingBytes === 1 ? 'byte' : 'bytes'}` : ''}. Decoded DAC levels before the mixer, filters and Master; not the live output scope.`;
    renderReadout(); draw();
  }
  function resize() {
    if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = Math.max(240,Math.round(canvas.clientWidth)), height = Math.max(170,Math.round(canvas.clientHeight));
    if (canvas.width === width && canvas.height === height) return;
    if (stroke) cancelDrawing();
    canvas.width = width; canvas.height = height; draw();
  }
  function render() {
    renderHistory();
    page = Math.max(0,Math.min(pages() - 1,page));
    const start = page * PAGE_BYTES, end = Math.min(decoded.hardwareBytes,start + PAGE_BYTES);
    selectedBit = Math.max(start * 8,Math.min(Math.max(0,end * 8 - 1),selectedBit));
    pageLabel.textContent = decoded.hardwareBytes ? `Bytes ${start}–${end - 1} / ${decoded.hardwareBytes} · page ${page + 1}/${pages()}` : 'No bytes';
    first.disabled = previous.disabled = page === 0;
    last.disabled = next.disabled = page === pages() - 1;
    renderBits(); renderWave(); resize();
  }
  const Resize = win.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof Resize === 'function') {const observer = new Resize(resize); observer.observe(canvas); cleanups.push(() => observer.disconnect());}
  else listen(win,'resize',resize);
  render();
  return {
    update(value, {resetHistory = false} = {}) {
      if (disposed) return;
      const dataChanged = !equalBytes(dmc.data,value.data);
      if (!resetHistory && !dataChanged && value.level === dmc.level && value.rate === dmc.rate && value.loop === dmc.loop) return;
      cancelDrawing(); lastTargets = null; lastFit = null; drawingStatus.textContent = drawingHint;
      const nextDecoded = decodeDpcm(value.data,value);
      dmc = {data:[...value.data], level:value.level, rate:value.rate, loop:value.loop}; decoded = nextDecoded;
      if (dataChanged || resetHistory) history.reset(dmc.data);
      if (dataChanged) {page = 0; selectedBit = 0;}
      render();
    },
    cancelDrawing() {cancelDrawing();},
    dispose() {if (disposed) return; cancelDrawing(); disposed = true; for (const cleanup of cleanups) cleanup(); section.remove();},
  };
}
