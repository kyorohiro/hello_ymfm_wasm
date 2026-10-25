#include "huc6280.h"
extern "C" {
void *huc6280_create(uint32_t clock,uint32_t rate){return clock && rate ? new Huc6280(clock,rate):nullptr;}
void huc6280_mute(Huc6280 *p,uint32_t ch,uint32_t muted){p->mute(ch,muted != 0);}
void huc6280_destroy(Huc6280 *p){delete p;}
void huc6280_reset(Huc6280 *p){p->reset();}
void huc6280_write(Huc6280 *p,uint32_t r,uint32_t v){p->write(r,v);}
void huc6280_generate(Huc6280 *p,float *l,float *r,uint32_t n){p->generate(l,r,n);}
}
