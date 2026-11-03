#include "k051649.h"
extern "C" {
void *k051649_create(uint32_t rate,uint32_t clock) {
    if(!rate || !clock)return nullptr;
    return new K051649(rate,clock);
}
void k051649_destroy(void *p){delete static_cast<K051649*>(p);}
void k051649_reset(void *p){static_cast<K051649*>(p)->reset();}
void k051649_write(void *p,uint8_t port,uint8_t reg,uint8_t value){static_cast<K051649*>(p)->write(port,reg,value);}
uint32_t k051649_sample_rate(void *p){return static_cast<K051649*>(p)->sample_rate();}
void k051649_set_mute_mask(void *p,uint32_t mask){static_cast<K051649*>(p)->set_mute_mask(mask);}
void k051649_generate(void *p,float *l,float *r,uint32_t n){static_cast<K051649*>(p)->generate(l,r,n);}
}
