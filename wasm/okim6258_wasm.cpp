#include "okim6258.h"
extern "C" {
void *okim6258_create(uint32_t clock,uint32_t flags,uint32_t rate){return clock && rate && (flags&4) ? new Oki6258(clock,flags,rate):nullptr;}
void okim6258_destroy(Oki6258 *p){delete p;}
void okim6258_reset(Oki6258 *p){p->reset();}
void okim6258_write(Oki6258 *p,uint32_t r,uint32_t v){p->write(r,v);}
void okim6258_generate(Oki6258 *p,float *l,float *r,uint32_t n){p->generate(l,r,n);}

uint32_t okim6258_save_state(Oki6258 *p, uint8_t *out) {
 std::vector<uint8_t> bytes; p->state(bytes, true);
 if (out) std::memcpy(out, bytes.data(), bytes.size()); return bytes.size();
}
int okim6258_load_state(Oki6258 *p, const uint8_t *data, uint32_t size) {
 if (!data || size != okim6258_save_state(p, nullptr)) return 0;
 std::vector<uint8_t> bytes(data, data + size); p->state(bytes, false); return 1;
}
}
