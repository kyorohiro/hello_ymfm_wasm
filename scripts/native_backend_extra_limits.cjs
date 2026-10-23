// Shared mock rack capacity, matching the Native rack across all supported kinds.
const extraChipMaps=['extraPsg','extraYm2612','extraYm2203','extraYm2608','extraYm2610','extraYm2151','extraYm2413','extraAy8910'];
const extraChipCount=native=>extraChipMaps.reduce((sum,name)=>sum+(native[name]?.size??0),0);
module.exports={extraChipMaps,extraChipCount};
