import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPokeyMonitor} from './pokey_monitor.js';

function element() {
  return {children: [], append(...children) {this.children.push(...children);}, replaceChildren(...children) {this.children = children;}};
}
test('POKEY monitor renders both chips without audio feedback and reset retains only external mute state', () => {
  const previous = globalThis.document;
  globalThis.document = {createElement: element};
  try {
    const root = element(), muted = new Set([4]);
    const monitor = mountPokeyMonitor(root, {isMuted: ch => muted.has(ch)});
    monitor.load({pokeyClock: 1789773 | 0x40000000});
    assert.equal(root.children.length, 3);
    assert.equal(root.children[0].children[0].textContent, 'POKEY 1');
    assert.equal(root.children[1].children[0].textContent, 'POKEY 2');
    monitor.write(0, 71, 1); monitor.write(1, 0xac, 1); monitor.write(9, 0, 1);
    // No synchronous render/audio dispatch is done by the register hook.
    assert.match(root.children[1].children[2].textContent, /Volume 0\/15/);
    monitor.render();
    assert.match(root.children[1].children[2].textContent, /CH1 · Muted · Tone/);
    assert.match(root.children[1].children[2].textContent, /Volume 12\/15/);
    assert.match(root.children[1].children[2].textContent, /Hz\)/);
    assert.match(root.children[1].children[1].textContent, /STIMER writes 1/);
    assert.match(root.children[0].children[2].textContent, /Volume 0\/15/);
    monitor.reset();
    assert.ok(monitor.describe().every(ch => ch.volume === 0));
    assert.match(root.children[1].children[2].textContent, /Muted/);
    assert.match(root.children[1].children[1].textContent, /STIMER writes 0/);
    monitor.load({pokeyClock: 1789790});
    assert.equal(root.children.length, 2);
    assert.equal(monitor.describe().length, 4);
    assert.equal(root.children[0].children[0].textContent, 'POKEY');
  } finally {globalThis.document = previous;}
});
