#include "segapcm.h"
extern "C" {
void *segapcm_create(uint32_t rate,uint32_t clock,uint8_t bankShift,uint8_t bankMask) {
    if(!rate || !clock)return nullptr;
    return new SegaPcm(rate,clock,bankShift,bankMask);
}
void segapcm_destroy(void *p){delete static_cast<SegaPcm*>(p);}
void segapcm_reset(void *p){static_cast<SegaPcm*>(p)->reset();}
void segapcm_write(void *p,uint16_t offset,uint8_t value){static_cast<SegaPcm*>(p)->write(offset,value);}
int segapcm_load_memory(void *p,const uint8_t *data,uint32_t size,uint32_t offset,uint32_t memorySize){
    return static_cast<SegaPcm*>(p)->loadSampleMemory(data,size,offset,memorySize);
}
void segapcm_clear_memory(void *p){static_cast<SegaPcm*>(p)->clearSampleMemory();}
uint32_t segapcm_sample_rate(void *p){return static_cast<SegaPcm*>(p)->sample_rate();}
void segapcm_set_mute_mask(void *p,uint32_t mask){static_cast<SegaPcm*>(p)->set_mute_mask(mask);}
void segapcm_generate(void *p,float *l,float *r,uint32_t n){static_cast<SegaPcm*>(p)->generate(l,r,n);}
}
