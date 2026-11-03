#include "gameboy_apu.h"
#include <cstring>
#include <type_traits>

// Same-build opaque snapshot. The core owns only scalars and inline arrays.
static_assert(std::is_trivially_copyable<GameboyApu>::value, "Game Boy state must not own pointers");
struct GameboyStateHeader { uint32_t magic, size, rate, clock; };
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
uint32_t gameboy_apu_save_state(void *p,uint8_t *out){
    if(!p)return 0;
    const auto &chip=*static_cast<GameboyApu*>(p);
    const uint32_t size=sizeof(GameboyStateHeader)+sizeof(GameboyApu);
    if(out){
        const GameboyStateHeader header{0x47424131,size,chip.sample_rate(),chip.input_clock()};
        std::memcpy(out,&header,sizeof(header));
        std::memcpy(out+sizeof(header),&chip,sizeof(chip));
    }
    return size;
}
int gameboy_apu_load_state(void *p,const uint8_t *data,uint32_t size){
    if(!p||!data||size!=sizeof(GameboyStateHeader)+sizeof(GameboyApu))return 0;
    auto &chip=*static_cast<GameboyApu*>(p);
    GameboyStateHeader header;std::memcpy(&header,data,sizeof(header));
    if(header.magic!=0x47424131||header.size!=size||header.rate!=chip.sample_rate()||header.clock!=chip.input_clock())return 0;
    GameboyApu restored=chip;std::memcpy(&restored,data+sizeof(header),sizeof(restored));
    if(restored.sample_rate()!=header.rate||restored.input_clock()!=header.clock)return 0;
    chip=restored;return 1;
}
}
