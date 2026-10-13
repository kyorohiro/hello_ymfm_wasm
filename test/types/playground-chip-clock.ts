/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />
type TetoricaSelectedChip = 'ym2612';
async function checkChipClockTypes() {
  const names = ['ym2612','ym2203','ym2610','ym2608','ym2151','segapsg','gameboy','nes','rf5c164','pwm'] as const;
  for (const name of names) {
    const chip = await useSoundChip(name);
    const hz: number = chip.clock;
    const completion: Promise<void> = chip.setClock(hz);
    await completion;
    // @ts-expect-error clock is read-only; changes must go through the audio processor
    chip.clock = 4000000;
    // @ts-expect-error Hz must be numeric
    chip.setClock('4000000');
  }
  const chips = [await createSoundChip('ym2612'), await createSoundChip('ym2203'), await createSoundChip('ym2610'),
    await createSoundChip('ym2608'),await createSoundChip('ym2151'),await createSoundChip('segapsg'),
    await createSoundChip('gameboy'),await createSoundChip('nes'),await createSoundChip('rf5c164'),await createSoundChip('pwm')];
  for (const chip of chips) await chip.setClock(chip.clock);
  await fm.setClock(fm.clock);
}

async function checkNesPulseFrequencyTypes() {
  const nes = await useSoundChip('nes');
  const timer:number = nes.pulse.setFrequency(0,440);
  nes.pulse.keyOn(0);
  nes.pulse.keyOff(0);
  nes.setFrequency(1,660);
  nes.keyOn(1);
  nes.keyOff(1);
  // @ts-expect-error pulse only accepts channels 0 and 1
  nes.pulse.keyOn(2);
  // @ts-expect-error Hz must be numeric
  nes.pulse.setFrequency(0,'A4');
  // @ts-expect-error noteOn still requires a musical note
  nes.pulse.noteOn(0);
}
