function checkNoBuiltInOpnaSections() {
  // @ts-expect-error primary SSG only exists in OPN/OPNA/OPNB modes
  pg.ssg;
  // @ts-expect-error the primary OPNA rhythm only exists in PC-98 OPNA mode
  pg.rhythm;
  // @ts-expect-error primary ADPCM-B only exists in OPNA/OPNB modes
  pg.adpcm;
  // @ts-expect-error primary ADPCM-A only exists in Neo Geo modes
  pg.adpcmA;
  // @ts-expect-error the ADPCM-B alias only exists in Neo Geo modes
  pg.adpcmB;
  livePrepare('without-primary-opna', context => {
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.ssg;
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.rhythm;
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.adpcm;
    // @ts-expect-error independent YM2610 sections are not primary mode globals
    context.adpcmA;
    // @ts-expect-error independent YM2610 sections are not primary mode globals
    context.adpcmB;
  });
}
