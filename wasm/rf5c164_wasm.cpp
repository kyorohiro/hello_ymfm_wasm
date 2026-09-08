#include "rf5c164.h"
extern "C" {
void *rf5c164_create(uint32_t rate, uint32_t clock) { return rate && clock ? new RF5C164(rate, clock) : nullptr; }
void rf5c164_destroy(RF5C164 *p) { delete p; }
void rf5c164_reset(RF5C164 *p) { p->reset(); }
void rf5c164_clear_memory(RF5C164 *p) { p->clear_memory(); }
void rf5c164_write(RF5C164 *p, uint8_t reg, uint8_t value) { p->write(reg, value); }
void rf5c164_write_memory(RF5C164 *p, uint16_t offset, uint8_t value) { p->write_memory(offset, value); }
uint8_t rf5c164_read_memory(RF5C164 *p, uint16_t offset) { return p->read_memory(offset); }
uint8_t rf5c164_read(RF5C164 *p, uint8_t offset) { return p->read(offset); }
uint32_t rf5c164_bank(RF5C164 *p) { return p->bank(); }
int rf5c164_load(RF5C164 *p, const uint8_t *data, uint32_t offset, uint32_t size) { return p->load(data, offset, size); }
uint32_t rf5c164_sample_rate(RF5C164 *p) { return p->sample_rate(); }
void rf5c164_generate(RF5C164 *p, float *left, float *right, uint32_t frames) { p->generate(left, right, frames); }
}
