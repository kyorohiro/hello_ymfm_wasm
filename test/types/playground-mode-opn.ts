function checkNonGenesisGlobals() {
  // @ts-expect-error the selected OPN environment has no Sega PSG
  pg.psg;
  // @ts-expect-error the selected OPN environment has no Sega PSG tone helper
  pg.psgTone(0, 400);
  // @ts-expect-error the selected OPN environment has no Sega PSG noise helper
  pg.psgNoise(0);
  // @ts-expect-error Sega PSG constants belong to Genesis modes
  pg.PSG1;
  // @ts-expect-error Sega PSG constants belong to Genesis modes
  pg.PSG2;
  // @ts-expect-error Sega PSG constants belong to Genesis modes
  pg.PSG3;
  livePrepare('opn-without-segapsg', context => {
    // @ts-expect-error livePrepare cannot provide a Sega PSG in OPN environments
    context.psg.noteOn(0, 'C4');
  });
}
