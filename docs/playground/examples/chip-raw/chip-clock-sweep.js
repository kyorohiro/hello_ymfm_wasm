// Change a sounding chip's master clock without retriggering its notes.
// Raw registers stay fixed: pitch, noise and hardware envelope speeds change.
// BPM, sleep/tween seconds and the output sample rate are independent.
const psg = await createSoundChip('segapsg');
const originalClock = psg.clock;
try {
  psg.tone(0, {note: 'C4', attenuation: 4});
  await tween(4, async progress => {
    // Sweep from half speed to twice the original speed.
    await psg.setClock(Math.round(originalClock * 2 ** (progress * 2 - 1)));
  });
  await psg.setClock(originalClock);
  await sleep(0.5);
} finally {
  psg.dispose();
}
