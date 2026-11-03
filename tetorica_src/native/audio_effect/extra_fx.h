#ifndef EXTRA_FX_H
#define EXTRA_FX_H
/* Graph types 7..14: filter, delay, distortion, bitcrusher, wobble,
 * flanger, slicer, chorus. Parameter layout documented in fx_controls.js. */
void extra_reset(double rate);
void extra_clear(void);
int extra_prepare(int type,int slot);
int extra_set(int type,int slot,int parameter,double value);
void extra_tick(int type,int slot,float *left,float *right);
#endif
