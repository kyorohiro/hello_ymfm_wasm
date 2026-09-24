setMasterVolume(1.0);

await sample.load(
  "sonic-pi/ambi-choir"
);

await sample.play("sonic-pi/ambi-choir", {
  gain: 0.9,
  fadeIn: 0.02,
  fadeOut: 0.2,
});

await sleep(1.2);

await sample.play("sonic-pi/ambi-choir", {
  gain: 0.7,
  playbackRate: 0.8,
  offset: 0.1,
  duration: 1.6,
  fadeIn: 0.02,
  fadeOut: 0.25,
  pan: -0.2,
});

await sleep(1.8);
