function checkNoBuiltInOpnaSections() {
  // @ts-expect-error the primary OPNA SSG only exists in PC-98 OPNA mode
  pg.ssg;
  // @ts-expect-error the primary OPNA rhythm only exists in PC-98 OPNA mode
  pg.rhythm;
  // @ts-expect-error the primary OPNA ADPCM-B only exists in PC-98 OPNA mode
  pg.adpcm;
  livePrepare('without-primary-opna', context => {
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.ssg;
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.rhythm;
    // @ts-expect-error independent YM2608 sections are not primary mode globals
    context.adpcm;
  });
}
