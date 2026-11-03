#ifndef NATIVE_REVERB_H
#define NATIVE_REVERB_H
void reverb_reset(double rate);
void reverb_clear(void);
void reverb_set(float mix, float room, float damping);
void reverb_tick(float *left, float *right);
#endif
