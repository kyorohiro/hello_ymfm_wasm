#include "rf5c164.h"
#include "native_genesis_rf5c164.h"
#include <cmath>
#include <cstdint>

namespace {
// Match web/playground_chip_clock.js. The canonical RF core stays at 12.5MHz;
// clock edits change how many canonical output samples advance per frame.
struct NativeRF5C164 {
    RF5C164 chip;
    bool resampling=false;
    double ratio=1, remainder=0, left=0, right=0;
    explicit NativeRF5C164(uint32_t rate):chip(rate,12500000){}
    void reset(){chip.reset();remainder=left=right=0;}
    void sample(float *l,float *r){
        if(!resampling){chip.generate(l,r,1);return;}
        remainder+=ratio;
        const uint32_t count=static_cast<uint32_t>(std::floor(remainder));
        remainder-=count;
        if(count){
            double sum_left=0,sum_right=0;
            for(uint32_t i=0;i<count;++i){float a,b;chip.generate(&a,&b,1);sum_left+=a;sum_right+=b;}
            left=sum_left/count;right=sum_right/count;
        }
        *l=static_cast<float>(left);*r=static_cast<float>(right);
    }
};
NativeRF5C164 *core(void *chip){return static_cast<NativeRF5C164 *>(chip);}
}
extern "C" {
void *native_rf5c164_create(uint32_t rate){try{return rate?new NativeRF5C164(rate):nullptr;}catch(...){return nullptr;}}
void native_rf5c164_destroy(void *chip){delete core(chip);}
void native_rf5c164_reset(void *chip){core(chip)->reset();}
void native_rf5c164_clear_memory(void *chip){core(chip)->chip.clear_memory();}
void native_rf5c164_write(void *chip,uint8_t reg,uint8_t value){core(chip)->chip.write(reg,value);}
void native_rf5c164_write_memory(void *chip,uint16_t offset,uint8_t value){core(chip)->chip.write_memory(offset,value);}
int native_rf5c164_load(void *chip,const uint8_t *data,uint32_t offset,uint32_t size){return core(chip)->chip.load(data,offset,size);}
void native_rf5c164_sample(void *chip,float *left,float *right){core(chip)->sample(left,right);}
void native_rf5c164_set_clock(void *chip, uint32_t clock) {
    core(chip)->resampling=true;
    core(chip)->ratio=static_cast<double>(clock)/12500000;
}
}
