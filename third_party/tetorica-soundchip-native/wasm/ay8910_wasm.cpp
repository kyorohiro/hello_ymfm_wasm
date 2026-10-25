#include "ay8910.h"
extern "C" {
void *ay8910_create(uint32_t rate,uint32_t clock,uint8_t type,uint8_t flags) {
    if(!rate || !clock || (type!=0 && type!=0x10) || (flags & ~0x11) || (type==0 && (flags & 0x10)))return nullptr;
    return new AY8910(rate,clock,type,flags);
}
void ay8910_destroy(void *p){delete static_cast<AY8910*>(p);}
void ay8910_reset(void *p){static_cast<AY8910*>(p)->reset();}
void ay8910_write(void *p,uint8_t r,uint8_t v){static_cast<AY8910*>(p)->write(r,v);}
uint8_t ay8910_read(void *p,uint8_t r){return static_cast<AY8910*>(p)->read(r);}
uint32_t ay8910_sample_rate(void *p){return static_cast<AY8910*>(p)->sample_rate();}
void ay8910_set_mute_mask(void *p,uint32_t mask){static_cast<AY8910*>(p)->set_mute_mask(mask);}
void ay8910_generate(void *p,float *l,float *r,uint32_t n){static_cast<AY8910*>(p)->generate(l,r,n);}
}
