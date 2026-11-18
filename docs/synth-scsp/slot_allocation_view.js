// SPDX-License-Identifier: BSD-3-Clause
// Detached requested ownership and authored routes; never an audio / ENV meter.
import { OPERATOR_NAMES, SOURCE_COUNT, operatorSlot, routing, voiceCommands } from './routing.js?v=scsp-cycle2-code-1';

const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : null;
const flag = value => typeof value === 'boolean' ? value : null;
const ch = slot => `CH${slot + 1}`;
const shown = value => value === null ? 'Unavailable' : String(value);
const heldText = held => held === null ? 'Held state unavailable' : held ? 'Held' : 'Released · retained';
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const note = midi => {
  if (!Number.isFinite(midi) || midi < 0 || midi > 127) return null;
  const nearest = Math.round(midi), name = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][nearest % 12];
  const cents = Math.round((midi - nearest) * 100);
  return `${name}${Math.floor(nearest / 12) - 1}${cents ? ` ${cents > 0 ? '+' : ''}${cents}¢` : ''}`;
};
const ownerCopy = value => value?.kind === 'keyboard' ? { kind: 'keyboard' } : value?.kind === 'code' ? {
  kind: 'code', channel: integer(value.channel, 0, 31),
  session: Number.isSafeInteger(value.session) && value.session >= 0 ? value.session : null,
} : { kind: 'unknown' };
const ownerText = owner => owner.kind === 'keyboard' ? 'Keyboard' : owner.kind === 'code'
  ? `Code CH${owner.channel === null ? '?' : owner.channel + 1}` : 'Owner unavailable';

function groupRecord(value) {
  try {
    if (!value || typeof value.id !== 'string' || !value.id || !Array.isArray(value.slots) || ![1, 2, 4, 6].includes(value.slots.length)) return null;
    const slots = Array.from(value.slots, slot => integer(slot, 0, 31));
    if (slots.includes(null) || new Set(slots).size !== slots.length || !['pcm', 'fm2', 'fm4', 'fm6'].includes(value.config?.mode)) return null;
    const graph = routing(value.config);
    if (graph.count !== slots.length) return null;
    const mapping = Array.from({ length: graph.count }, (_, index) => operatorSlot(value, index));
    if (new Set(mapping).size !== slots.length || mapping.some(slot => !slots.includes(slot))) return null;
    // Ask the same command recipe used for allocation for expected settings.
    // Neutral source metadata avoids depending on subsequently edited templates.
    const source = Array.from({ length: SOURCE_COUNT }, () => ({ sample: { loopStartSamples: 0 } }));
    const commands = voiceCommands({ getState: () => ({ slots: source }) }, value.config, value);
    const expected = new Map(commands.filter(([method]) => method === 'setPreset').map(([, [slot, preset]]) => [slot, preset.modulation]));
    return {
      id: value.id, key: `group:${value.id}`, slots, mapping, graph, expected,
      config: value.config, mode: value.config.mode, algorithm: value.config.fm?.algorithm ?? null,
      held: flag(value.held), order: Number.isSafeInteger(value.order) && value.order >= 0 ? value.order : null,
      midi: Number.isFinite(value.midi) ? value.midi : null, owner: ownerCopy(value.owner),
    };
  } catch { return null; }
}

function sendFor(state, slot, ownership, group, operator) {
  const requested = state?.dspRouting?.slots?.[slot];
  const input = integer(requested?.input, 0, 1), level = integer(requested?.level, 0, 7);
  const effectEnabled = flag(state?.config?.effect?.enabled);
  const owned = ownership === 'group' || ownership === 'manual';
  const override = state?.dspRoutingOverrides?.slots?.[slot] ?? (group ? state?.dspRoutingOverrides?.sources?.[operator] : null);
  const explicit = !!override;
  const defaultOutput = group ? group.graph.outputs.includes(operator) : ownership === 'manual' ? state.slots[slot].directLevel > 0 : false;
  const policy = !owned ? 'unowned · suppressed' : effectEnabled === false ? 'effect disabled'
    : effectEnabled === null ? 'enable unavailable' : explicit ? 'explicit request' : defaultOutput ? 'output default' : 'no default send';
  return { input, level, requested: true, effectEnabled, explicit, defaultOutput, policy };
}

function memberFor(state, metadata, group, operator) {
  const slot = metadata.slot, voice = state.slots[slot], raw = voice.modulation;
  const modulation = {
    depth: integer(raw?.depth, 0, 15), xOffset: integer(raw?.xOffset, 0, 63),
    yOffset: integer(raw?.yOffset, 0, 63), writeInhibit: flag(raw?.writeInhibit),
  };
  const expected = group?.expected.get(slot);
  const matchesRecipe = !!expected && group.recipeMatches && Object.entries(modulation).every(([key, value]) => value !== null && value === expected[key]);
  const sources = matchesRecipe ? group.graph.inputs[operator] : [];
  const references = ['X', 'Y'].map((input, index) => {
    const offset = index ? modulation.yOffset : modulation.xOffset;
    const from = sources[index] ?? sources[0] ?? null;
    const self = from === operator;
    const timing = from === null ? 'raw' : group.algorithm === 'cycle2' && operator === 0 ? 'history average'
      : self ? `history ${index + 1}` : 'current';
    return { input, offset, sourceOperator: from, sourceSlot: from === null ? null : group.mapping[from], timing,
      enabled: modulation.depth === null ? null : modulation.depth > 0 };
  });
  return {
    slot, operator, name: operator === null ? ch(slot) : OPERATOR_NAMES[operator],
    ownership: metadata.ownership, held: metadata.held, selected: metadata.selected,
    sourceTemplate: slot < SOURCE_COUNT, matchesRecipe, references, modulation,
    direct: { level: integer(voice.directLevel, 0, 7), pan: integer(voice.pan, 0, 31) },
    dsp: sendFor(state, slot, metadata.ownership, group, operator), gate: flag(voice.gate),
  };
}

/** Describe only current allocation records; Code lanes and requested gates do not grant ownership. */
export function describeScspSlotAllocation(state, { selected = null, operator = 0 } = {}) {
  const physical = selected === null ? null : integer(selected, 0, 31), sourceOperator = integer(operator, 0, 5);
  const coherent = Array.isArray(state?.slots) && state.slots.length === 32 && Array.from(state.slots).every(value => value && typeof value === 'object');
  const available = !!coherent && (selected === null || physical !== null);
  const slots = Array.from({ length: 32 }, (_, slot) => ({ slot, related: false, selected: physical === slot,
    role: slot < SOURCE_COUNT ? 'source' : 'physical', operator: slot < SOURCE_COUNT ? slot : null,
    ownership: coherent ? slot < SOURCE_COUNT ? 'source' : 'unowned' : 'unknown', held: null,
    groupKey: null, groupId: null, description: coherent ? slot < SOURCE_COUNT ? `Source ${OPERATOR_NAMES[slot]} · ${ch(slot)}` : `${ch(slot)} · unowned` : `${ch(slot)} · unavailable` }));
  const model = { available, selection: selected === null ? 'auto' : 'physical', selected: physical, operator: sourceOperator,
    focus: { kind: 'unavailable', summary: coherent ? 'Choose Auto or CH1–32.' : 'Synth physical state unavailable.' },
    slots, members: [], connections: [], reason: '' };
  if (!available) { model.reason = model.focus.summary; return freeze(model); }
  const claims = Array.from({ length: 32 }, () => []), groups = [];
  for (const value of Array.isArray(state.voiceGroups) ? state.voiceGroups : []) {
    const group = groupRecord(value);
    if (group) {
      // Changed producer settings (including STWINH) also invalidate recipe arrows.
      group.recipeMatches = group.mapping.every(slot => {
        const raw = state.slots[slot].modulation, expected = group.expected.get(slot);
        return expected && Object.entries(expected).every(([key, value]) => raw?.[key] === value);
      });
      groups.push(group);
      group.mapping.forEach((slot, index) => claims[slot].push({ kind: 'group', group, operator: index }));
    } else for (const slot of Array.isArray(value?.slots) ? value.slots : []) if (integer(slot, 0, 31) !== null) claims[slot].push({ kind: 'unknown' });
  }
  for (const value of Array.isArray(state.manualVoices) ? state.manualVoices : []) {
    if (integer(value?.slot, 0, 31) !== null) claims[value.slot].push({ kind: 'manual', value });
  }
  for (const [slot, entries] of claims.entries()) {
    if (!entries.length) continue;
    const record = slots[slot], entry = entries[0];
    if (entries.length !== 1 || entry.kind === 'unknown') {
      Object.assign(record, { ownership: 'unknown', operator: null, description: `${ch(slot)} · ownership unavailable` });
    } else if (entry.kind === 'group') {
      const group = entry.group;
      Object.assign(record, { ownership: 'group', operator: entry.operator, held: group.held, groupKey: group.key, groupId: group.id,
        description: `${ch(slot)} · ${ownerText(group.owner)} · ${note(group.midi) ?? 'Note unavailable'} · OP ${OPERATOR_NAMES[entry.operator]} · ${heldText(group.held)}` });
    } else {
      Object.assign(record, { ownership: 'manual', operator: null, held: flag(entry.value.held),
        description: `${ch(slot)} · physical key · ${note(entry.value.midi) ?? 'Note unavailable'} · ${heldText(flag(entry.value.held))}${slot < SOURCE_COUNT ? ` · Source ${OPERATOR_NAMES[slot]}` : ''}` });
    }
  }
  let group = null, manual = null, focusSlot = physical;
  if (selected === null) {
    group = groups.filter(value => value.order !== null && value.slots.every(slot => slots[slot].groupKey === value.key))
      .sort((a, b) => b.order - a.order)[0] ?? null;
    if (!group) focusSlot = sourceOperator;
  } else if (slots[physical].ownership === 'group') {
    const candidate = claims[physical][0].group;
    if (candidate.slots.every(slot => slots[slot].groupKey === candidate.key)) group = candidate;
    else Object.assign(slots[physical], { ownership: 'unknown', operator: null, held: null, groupKey: null, groupId: null,
      description: `${ch(physical)} · group ownership incomplete · settings only` });
  }
  if (group) {
    const summary = `${ownerText(group.owner)} · ${note(group.midi) ?? 'Note unavailable'} · ${heldText(group.held)}`;
    model.focus = { kind: 'group', summary, groupId: group.id, groupKey: group.key, midi: group.midi, note: note(group.midi),
      held: group.held, owner: { ...group.owner }, order: group.order, mode: group.mode, algorithm: group.algorithm,
      slots: [...group.slots], selectedOperator: selected === null ? sourceOperator !== null && sourceOperator < group.mapping.length ? sourceOperator : null : slots[physical].operator };
    group.mapping.forEach((slot, index) => { slots[slot].related = true; model.members.push(memberFor(state, slots[slot], group, index)); });
  } else if (focusSlot !== null) {
    const metadata = slots[focusSlot];
    metadata.related = true;
    manual = metadata.ownership === 'manual' ? claims[focusSlot][0].value : null;
    const kind = metadata.ownership === 'unknown' ? 'unavailable' : metadata.ownership;
    const summary = selected === null ? `Auto · no allocated group · ${manual ? metadata.description : `Source ${OPERATOR_NAMES[sourceOperator]} (${ch(focusSlot)})`}` : metadata.description;
    model.focus = { kind, summary, slot: focusSlot, slots: [focusSlot], selectedOperator: metadata.operator,
      held: metadata.held, midi: Number.isFinite(manual?.midi) ? manual.midi : null, note: note(manual?.midi),
      ...(manual ? { owner: { kind: 'physical' }, manualId: typeof manual.id === 'string' ? manual.id : null } : {}) };
    model.members.push(memberFor(state, metadata, null, metadata.operator));
  }
  for (const member of model.members) for (const reference of member.references) if (reference.sourceOperator !== null) model.connections.push({
    from: reference.sourceOperator, fromSlot: reference.sourceSlot, to: member.operator, toSlot: member.slot,
    input: reference.input, offset: reference.offset, timing: reference.timing, depth: member.modulation.depth, enabled: reference.enabled,
  });
  model.reason = model.focus.kind === 'group' ? `${model.focus.mode.toUpperCase()} · ${model.focus.algorithm === 'cycle2' ? 'Cycle 2OP' : model.focus.algorithm ?? 'PCM'} · requested ownership`
    : model.focus.kind === 'source' ? 'Source template · no allocated voice group' : 'Physical settings · requested ownership';
  return freeze(model);
}

const inputText = member => {
  const depth = `Depth ${shown(member.modulation.depth)}${member.modulation.depth === 0 ? ' · off' : ''}`;
  if (!member.matchesRecipe) return `Requested X ${shown(member.references[0].offset)} / Y ${shown(member.references[1].offset)} · ${depth}`;
  if (member.references.every(value => value.sourceOperator === null)) return `No modulation input · ${depth}`;
  return member.references.map(value => `${value.input} ← ${OPERATOR_NAMES[value.sourceOperator]} ${value.timing}`).join(' · ') + ` · ${depth}`;
};
const connectionText = member => {
  const routes = member.references.filter(value => value.sourceOperator !== null);
  if (!routes.length) return member.matchesRecipe ? `${member.name}: no modulation input` : `${member.name}: requested X ${shown(member.modulation.xOffset)} / Y ${shown(member.modulation.yOffset)} · producer unavailable`;
  const first = routes[0], same = routes.length === 2 && first.sourceOperator === routes[1].sourceOperator && first.timing === routes[1].timing;
  const label = route => `${OPERATOR_NAMES[route.sourceOperator]} (${ch(route.sourceSlot)}) → ${member.name} (${ch(member.slot)}) · ${route.timing}`;
  return (same ? `${label(first)} · X+Y` : routes.map(value => `${label(value)} · ${value.input}`).join('; ')) + ` · depth ${shown(member.modulation.depth)}${member.modulation.depth === 0 ? ' · off' : ''}`;
};

/** Stable passive DOM: polling never replaces controls, steals focus, or closes help. */
export function setupScspSlotAllocationView({ root } = {}) {
  if (!root?.ownerDocument) return { update() {}, dispose() {} };
  const doc = root.ownerDocument;
  const node = (tag, suffix, className, content) => {
    const value = doc.createElement(tag);
    if (suffix) value.id = `scspSynthAllocation${suffix}`;
    if (className) value.className = `scsp-synth-allocation-${className}`;
    if (content !== undefined) value.textContent = content;
    return value;
  };
  const heading = node('div', null, 'heading'), badge = node('span', 'Badge', 'badge');
  heading.append(node('h3', null, 'title', 'Synth slot allocation'), badge);
  const help = node('details', 'Help', 'help'), summary = node('summary', null, 'help-summary', '?');
  summary.setAttribute('aria-label', 'About Synth slot allocation');
  help.append(summary, node('p', null, 'help-text', 'Auto follows the latest allocated voice group, including a released group retained by the allocator. Choosing a physical CH follows its current owner. Held and Released are requested ownership, not native envelope phases or measured audio; retained slots are not free. A–F identities come from that group’s saved mapping and configuration, which can differ from the current editor preset. Source A–F uses CH1–6 as templates and can also have a physical key owner. Arrows name authored connections only while requested modulation settings match the allocation recipe. Self uses two distinct history taps; Cycle 2OP sends A current to B and averages B history into A. Depth 0 disables address modulation; requested offsets can remain visible while the hardware word is zero. Changed or unowned X/Y settings never identify an arbitrary producer. Direct and MIXS levels are requested physical settings, not meters. Requested MIXS routes can be suppressed by ownership, the default output policy or disabled effects; DSP returns depend on the program.'));
  heading.append(help);
  const owner = node('p', 'Owner', 'owner'), status = node('p', 'Status', 'status'), mapping = node('p', 'Mapping', 'mapping');
  const diagram = node('div', 'Diagram', 'diagram');
  diagram.setAttribute('role', 'group');
  diagram.setAttribute('aria-label', 'Current Synth group operator to physical channel mapping and requested sends');
  const cards = OPERATOR_NAMES.map(name => {
    const card = node('div', `Op${name}`, 'member'), title = node('h4', null, 'name'), inputs = node('p', null, 'inputs');
    const direct = node('p', null, 'direct'), send = node('p', null, 'send');
    card.append(title, inputs, direct, send); diagram.append(card);
    return { card, title, inputs, direct, send };
  });
  const connections = node('div', 'Connections', 'connections');
  connections.setAttribute('aria-label', 'Requested modulation connections');
  const lines = OPERATOR_NAMES.map(() => { const line = node('p', null, 'connection'); connections.append(line); return line; });
  root.replaceChildren(heading, owner, status, mapping, diagram, connections);
  let disposed = false;
  const text = (target, value) => { if (target.textContent !== value) target.textContent = value; };
  const data = (target, key, value) => { value = String(value ?? ''); if (target.dataset[key] !== value) target.dataset[key] = value; };
  const hide = (target, value) => { if (target.hidden !== value) target.hidden = value; };
  return {
    update(state, options) {
      if (disposed) return;
      const model = describeScspSlotAllocation(state, options), focus = model.focus;
      data(root, 'available', model.available); data(root, 'kind', focus.kind); data(root, 'groupId', focus.groupId);
      data(root, 'selected', model.selected); data(root, 'editorOperator', model.operator);
      text(badge, focus.kind === 'group' || focus.kind === 'manual' ? heldText(focus.held) : focus.kind === 'source' ? 'Source' : focus.kind === 'unowned' ? 'Unowned' : 'Unavailable');
      text(owner, focus.summary);
      text(status, `${model.reason}${model.selection === 'auto' && model.operator !== null ? ` · editor Source ${OPERATOR_NAMES[model.operator]}` : ''}`);
      text(mapping, focus.kind === 'group' ? model.members.map(member => `${member.name} → ${ch(member.slot)}`).join(' · ') : focus.slot === undefined ? '' : ch(focus.slot));
      cards.forEach(({ card, title, inputs, direct, send }, index) => {
        const member = model.members[index]; hide(card, !member); hide(lines[index], !member);
        if (!member) return;
        data(card, 'slot', member.slot); data(card, 'operator', member.operator === null ? null : OPERATOR_NAMES[member.operator]); data(card, 'recipe', member.matchesRecipe);
        data(card, 'selected', focus.selectedOperator === member.operator && member.operator !== null || model.selected === member.slot);
        text(title, member.operator === null ? ch(member.slot) : `${member.name} → ${ch(member.slot)}`);
        text(inputs, inputText(member));
        text(direct, `Direct · level ${shown(member.direct.level)} · pan ${shown(member.direct.pan)}`);
        text(send, `Requested MIXS${member.dsp.input === null ? '?' : member.dsp.input} · send ${shown(member.dsp.level)} · ${member.dsp.policy}`);
        text(lines[index], connectionText(member));
      });
    },
    dispose() { disposed = true; },
  };
}
