#!/usr/bin/env node
'use strict';

// A focused, silent renderer-clock diagnostic. A sample-counted Float32 pilot
// detects missing/repeated PCM independently of the browser's currentFrame.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {
  PILOT_PERIOD, PROCESSOR_NAMES, processorSource,
  analyzePilotPcm, analyzeClockRows, hashFloat32Pcm,
} = require('./audio_clock_audit.cjs');

const usage = 'Usage: node scripts/check_audio_clock_browser.cjs [--chromium-only | --webkit-only] [--repeats N] [--out REPORT.json]';

function parseArguments(args) {
  const config = {engines: ['chromium', 'webkit'], repeats: 1, out: null, help: false};
  let selectedEngine = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') { config.help = true; continue; }
    if (argument === '--chromium-only' || argument === '--webkit-only') {
      assert(!selectedEngine, 'Choose only one browser flag. ' + usage);
      selectedEngine = true;
      config.engines = [argument.slice(2, -5)];
      continue;
    }
    const match = argument.match(/^--(repeats|out)(?:=(.*))?$/);
    assert(match, usage);
    const value = match[2] ?? args[++index];
    assert(value && !value.startsWith('--'), usage);
    if (match[1] === 'out') config.out = path.resolve(value);
    else {
      assert(/^[1-9][0-9]*$/.test(value), '--repeats must be a positive integer.');
      config.repeats = Number(value);
      assert(Number.isSafeInteger(config.repeats) && config.repeats <= 100,
        '--repeats must be between 1 and 100.');
    }
  }
  return config;
}

async function runScene(page, config) {
  return page.evaluate(async ({config, names}) => {
    const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const context = new AudioContext(config.requestedSampleRate === null ? {} :
      {sampleRate: config.requestedSampleRate});
    const sum = context.createGain();
    const gate = context.createGain();
    const merger = context.createChannelMerger(2);
    gate.gain.value = 0;
    const checkMuted = () => {
      if (gate.gain.value !== 0) throw Error('Physical output gain must remain exactly zero');
    };
    checkMuted();
    if (config.topology === 'parallel') sum.connect(gate);
    gate.connect(context.destination);
    merger.connect(sum);
    const processorErrors = [];
    const observe = node => {
      node.addEventListener('processorerror', () => processorErrors.push(node.processorName ?? 'worklet'));
      return node;
    };
    const mutations = [];
    try {
      await context.audioWorklet.addModule('/audio-clock-worklet.js');
      const source = observe(new AudioWorkletNode(context, names.pilot, {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      }));
      source.connect(merger, 0, 0);
      const capture = observe(new AudioWorkletNode(context, names.capture, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: {pilotInput: 0},
      }));
      sum.connect(capture);
      capture.connect(gate);
      await context.resume();
      await sleep(300);
      checkMuted();
      let pendingCapture = null;
      capture.port.onmessage = ({data}) => {
        if (pendingCapture?.id !== data.id) return;
        const pending = pendingCapture;
        pendingCapture = null;
        clearTimeout(pending.timer);
        pending.resolve(data);
      };
      const windows = [];
      for (let window = 0; window < 3; window++) {
        const frames = 128 * 375;
        const capturePromise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Audio clock capture timed out')), 15000);
          pendingCapture = {id: window + 1, resolve, timer};
          capture.port.postMessage({id: window + 1, frames});
        });
        const mutationPromise = (async () => {
          if (config.extra === 'none') return;
          const kinds = config.extra === 'mixed' ?
            ['oscillator', 'worklet', 'worklet'] : ['worklet', 'worklet', 'worklet'];
          for (let index = 0; index < kinds.length; index++) {
            await sleep(index === 0 ? 100 : 60);
            checkMuted();
            const kind = kinds[index];
            const extra = kind === 'oscillator' ? context.createOscillator() :
              observe(new AudioWorkletNode(context, names.extra, {
                numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
              }));
            extra.connect(merger, 0, 1);
            if (extra.start) extra.start();
            mutations.push({type: 'connect', kind, window, index, time: context.currentTime});
            await sleep(100);
            if (extra.stop) extra.stop();
            else if (config.extra === 'mixed') extra.port.postMessage('stop');
            extra.disconnect();
            if (config.extra === 'mixed' && extra.port) extra.port.close();
            mutations.push({type: 'disconnect', kind, window, index, time: context.currentTime});
            checkMuted();
          }
        })();
        const [data] = await Promise.all([capturePromise, mutationPromise]);
        checkMuted();
        const channels = [data.left, data.right].map(values => {
          let peak = 0;
          let nonFinite = 0;
          for (const value of values) {
            if (!Number.isFinite(value)) nonFinite++;
            else peak = Math.max(peak, Math.abs(value));
          }
          return {peak, nonFinite, frames: values.length};
        });
        windows.push({
          window, contextTime: context.currentTime, frames,
          inputFrames: data.inputFrames, pilotInputFrames: data.pilotInputFrames,
          firstFrame: data.firstFrame, lastFrame: data.lastFrame,
          frameGaps: data.frameGaps, gaps: data.gaps, quantumFrames: data.quantumFrames,
          rows: data.rows, pilot: Array.from(data.pilot), channels,
        });
        await sleep(50);
      }
      const sourceStatus = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Pilot status timed out')), 5000);
        source.port.onmessage = ({data}) => { clearTimeout(timer); resolve(data); };
        source.port.postMessage('status');
      });
      checkMuted();
      return {
        ...config, sampleRate: context.sampleRate, contextState: context.state,
        currentTime: context.currentTime, physicalOutputMuted: gate.gain.value === 0,
        connections: {
          primary: 'merger input 0', extra: 'merger input 1',
          sum: config.topology === 'parallel' ? ['zeroGain', 'capture'] : ['capture'],
          capture: 'zeroGain', gate: 'destination', physicalGain: gate.gain.value,
        },
        windows, sourceStatus, mutations, processorErrors,
      };
    } finally {
      checkMuted();
      await context.close();
    }
  }, {config, names: PROCESSOR_NAMES});
}

async function main(args = process.argv.slice(2)) {
  const config = parseArguments(args);
  if (config.help) { console.log(usage); return; }
  const {chromium, webkit} = require('playwright');
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const scriptBytes = await fs.readFile(__filename);
  const helperPath = require.resolve('./audio_clock_audit.cjs');
  const helperBytes = await fs.readFile(helperPath);
  const report = {
    schemaVersion: 1, passed: false, pcmContinuous: true, clockContinuous: true,
    stableGlobalReads: true, physicalOutputMuted: true, listeningPerformed: false,
    purpose: 'Check actual pilot PCM continuity independently of browser global-clock diagnostics.',
    clockPolicy: 'Clock anomalies are retained separately; PASS does not assert browser-clock conformance or physical-device deadline coverage.',
    pilotPeriod: PILOT_PERIOD, warmupMilliseconds: 300, windowsPerScene: 3,
    framesPerWindow: 48000, repeats: config.repeats, results: [], errors: [],
    checkerSha256: sha256(scriptBytes), helperSha256: sha256(helperBytes),
    processorSha256: sha256(processorSource),
  };
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/audio-clock-worklet.js') {
      response.writeHead(200, {'Content-Type': 'text/javascript'}).end(processorSource);
    } else if (request.url === '/') {
      response.writeHead(200, {'Content-Type': 'text/html'}).end(
        '<!doctype html><title>Muted audio clock and PCM diagnostic</title>');
    } else if (request.url === '/favicon.ico') response.writeHead(204).end();
    else response.writeHead(404).end('Unknown diagnostic asset');
  });
  const save = async () => {
    if (!config.out) return;
    await fs.mkdir(path.dirname(config.out), {recursive: true});
    await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of config.engines) {
      const browser = await ({chromium, webkit})[name].launch({
        headless: true,
        ...(name === 'chromium' ? {args: ['--autoplay-policy=no-user-gesture-required']} : {}),
      });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          if (response.status() >= 400) errors.push(response.status() + ': ' + response.url());
        });
        await page.goto(origin);
        for (let repeat = 0; repeat < config.repeats; repeat++) {
          for (const topology of ['parallel', 'serial']) {
            for (const extra of ['none', 'mixed', 'disconnect-only']) {
              const result = await runScene(page, {
                repeat, topology, extra, requestedSampleRate: repeat === 0 ? null : 48000,
              });
              result.browser = name;
              result.browserVersion = browser.version();
              for (const window of result.windows) {
                window.pcm = analyzePilotPcm(window.pilot, {
                  expectedFrames: window.frames, pilotInputFrames: window.pilotInputFrames,
                });
                window.pilotSha256 = hashFloat32Pcm(window.pilot);
                window.clock = analyzeClockRows(window.rows);
                delete window.pilot;
                if (!window.pcm.continuous) report.pcmContinuous = false;
                if (!window.clock.continuous) report.clockContinuous = false;
                if (window.clock.unstableReadCount) report.stableGlobalReads = false;
                if (!window.clock.measurementValid) report.errors.push('Malformed capture rows');
                if (window.channels.some(channel => channel.nonFinite)) report.errors.push('Nonfinite captured audio');
              }
              if (result.processorErrors.length) report.errors.push(...result.processorErrors);
              assert(result.physicalOutputMuted && result.connections.physicalGain === 0);
              report.results.push(result);
              console.log(JSON.stringify({
                browser: name, repeat, topology, extra, sampleRate: result.sampleRate,
                pcmGaps: result.windows.map(window => window.pcm.sampleGapCount),
                clockGaps: result.windows.map(window => window.clock.gapCount),
                unstableReads: result.windows.map(window => window.clock.unstableReadCount),
              }));
              await save();
            }
          }
        }
        report.errors.push(...errors);
      } finally {
        await browser.close();
      }
    }
    assert.equal(sha256(await fs.readFile(__filename)), report.checkerSha256,
      'Checker bytes remained frozen');
    assert.equal(sha256(await fs.readFile(helperPath)), report.helperSha256,
      'Clock helper bytes remained frozen');
    report.windowsChecked = report.results.reduce((sum, result) => sum + result.windows.length, 0);
    report.samplesChecked = report.results.reduce((sum, result) =>
      sum + result.windows.reduce((count, window) => count + window.pcm.frames, 0), 0);
    report.passed = report.pcmContinuous && report.errors.length === 0;
    await save();
    assert(report.passed, 'Audio PCM continuity check failed; see report diagnostics');
    console.log(`PASS: ${report.windowsChecked} windows, ${report.samplesChecked} pilot samples; ` +
      `clockContinuous=${report.clockContinuous}, physical output muted.`);
  } catch (error) {
    report.errors.push(error.stack ?? String(error));
    report.passed = false;
    await save();
    throw error;
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});

module.exports = {parseArguments, runScene, main};
