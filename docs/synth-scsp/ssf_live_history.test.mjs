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
