#ifndef NATIVE_COMPRESSOR_H
#define NATIVE_COMPRESSOR_H
void compressor_reset(double rate);
void compressor_clear(void);
void compressor_set(float threshold, float ratio, float attack_ms, float release_ms, float makeup, int bypass);
void compressor_tick(float *left, float *right);
#endif
