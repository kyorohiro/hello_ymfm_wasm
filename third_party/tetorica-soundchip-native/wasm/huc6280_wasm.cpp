#include "huc6280.h"
#include <tetorica/huc6280_state.h>
#ifdef __EMSCRIPTEN__
#include <emscripten/heap.h>
#endif
namespace {
bool state_buffer(const void *data, uint32_t size) {
    if (!data || size != Huc6280::state_bytes) return false;
#ifdef __EMSCRIPTEN__
    const uintptr_t start = reinterpret_cast<uintptr_t>(data), limit = emscripten_get_heap_size();
    if (start > limit || size > limit - start) return false;
#endif
    return true;
}
}
extern "C" {
void *huc6280_create(uint32_t clock,uint32_t rate){return clock && rate ? new Huc6280(clock,rate):nullptr;}
void huc6280_mute(void *p,uint32_t ch,uint32_t muted){static_cast<Huc6280*>(p)->mute(ch,muted != 0);}
void huc6280_destroy(void *p){delete static_cast<Huc6280*>(p);}
void huc6280_reset(void *p){static_cast<Huc6280*>(p)->reset();}
void huc6280_write(void *p,uint32_t r,uint32_t v){static_cast<Huc6280*>(p)->write(r,v);}
void huc6280_generate(void *p,float *l,float *r,uint32_t n){static_cast<Huc6280*>(p)->generate(l,r,n);}
uint32_t huc6280_state_size(void *p){return p ? Huc6280::state_bytes : 0;}
int huc6280_save_state(void *p,uint8_t *data,uint32_t size){return p && state_buffer(data,size) && static_cast<Huc6280*>(p)->save_state(data,size);}
int huc6280_validate_state(void *p,const uint8_t *data,uint32_t size){return p && state_buffer(data,size) && static_cast<Huc6280*>(p)->validate_state(data,size);}
int huc6280_load_state(void *p,const uint8_t *data,uint32_t size){return p && state_buffer(data,size) && static_cast<Huc6280*>(p)->load_state(data,size);}
}
