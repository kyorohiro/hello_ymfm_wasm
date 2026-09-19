#include "gameboy_apu.h"
extern "C" {
void *gameboy_apu_create(uint32_t rate,uint32_t clock) {
    if(!rate || !clock)return nullptr;
    return new GameboyApu(rate,clock);
}
void gameboy_apu_destroy(void *p){delete static_cast<GameboyApu*>(p);}
void gameboy_apu_reset(void *p){static_cast<GameboyApu*>(p)->reset();}
void gameboy_apu_write(void *p,uint8_t offset,uint8_t value){static_cast<GameboyApu*>(p)->write(offset,value);}
uint32_t gameboy_apu_sample_rate(void *p){return static_cast<GameboyApu*>(p)->sample_rate();}
void gameboy_apu_set_mute_mask(void *p,uint32_t mask){static_cast<GameboyApu*>(p)->set_mute_mask(mask);}
void gameboy_apu_generate(void *p,float *l,float *r,uint32_t n){static_cast<GameboyApu*>(p)->generate(l,r,n);}
}
