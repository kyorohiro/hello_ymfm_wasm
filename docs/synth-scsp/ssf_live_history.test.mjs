import test from 'node:test';
import assert from 'node:assert/strict';
import { createScspSsfLiveHistory } from './ssf_live_history.js';

test('Live history excludes future native state and keeps one past state with bounded lookahead', () => {
	const history = createScspSsfLiveHistory(4);
	for (const frame of [0, 588, 588, 1176, 1764]) history.push({ frame });
	assert.equal(history.size, 4);
	assert.equal(history.at(500).frame, 0);
	assert.equal(history.at(600).frame, 588);
	history.prune(600);
	assert.equal(history.size, 3);
	assert.equal(history.at(600).frame, 588);
	for (const frame of [2352, 2940, 3528]) history.push({ frame });
	assert.equal(history.size, 4);
	assert.equal(history.at(600), null);
	history.clear();
	assert.equal(history.at(4000), null);
});

test('DSP and voice buffers share the bounded audible-history budget', () => {
	const history = createScspSsfLiveHistory();
	for (let frame = 0; frame < 20; frame++) history.push({frame,
		ram: new Uint8Array(524288),
		slots: Array.from({length:32}, () => ({registers:new Uint16Array(16)})),
		dsp:{frame,program:new Uint16Array(512),coefficients:new Int16Array(64),addresses:new Uint16Array(32),outputs:new Int16Array(16)},
	});
	const perSnapshot = 524288 + 32 * 32 + 1024 + 128 + 64 + 32;
	assert.equal(history.size, 15);assert.equal(history.bytes, perSnapshot * 15);
	assert(history.bytes <= 8 * 1024 * 1024);assert.equal(history.at(4), null);
	assert.equal(history.at(8).dsp.frame, 8, 'DSP and voice use one audible snapshot');
	history.prune(17);assert.equal(history.size, 3);assert.equal(history.bytes, perSnapshot * 3);
	history.clear();assert.equal(history.size, 0);assert.equal(history.bytes, 0);
});

test('oversized snapshots do not replace a usable past observation', () => {
	const history = createScspSsfLiveHistory(), valid={frame:0,ram:new Uint8Array(32)};
	history.push(valid);history.push({frame:10,ram:new Uint8Array(8*1024*1024+1)});
	assert.equal(history.size, 1);assert.equal(history.bytes, 32);assert.equal(history.at(10), valid);
});
