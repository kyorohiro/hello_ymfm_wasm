/* Stereo-linked peak compressor, hard knee, no lookahead.
 * Attack/release smooth gain reduction in dB (time constants, not completion times).
 * Not a brick-wall limiter: transients can pass during attack. */
#include <math.h>
#include "compressor.h"
static double rate=48000, attack, release, smooth;
static double threshold=-18, ratio=4, makeup=0, wet=0;
static double target_threshold=-18, target_ratio=4, target_makeup=0, target_wet=0;
static double reduction=0;
void compressor_clear(void) { reduction=0; }
void compressor_reset(double sr) {
    if(isfinite(sr) && sr>=16000 && sr<=384000) rate=sr;
    threshold=target_threshold=-18; ratio=target_ratio=4;
    makeup=target_makeup=0; wet=target_wet=0;
    attack=exp(-1/(0.01*rate)); release=exp(-1/(0.15*rate));
    smooth=1-exp(-1/(0.01*rate));
    compressor_clear();
}
void compressor_set(float t,float r,float a,float rel,float m,int bypass) {
    if(!isfinite(t)||!isfinite(r)||!isfinite(a)||!isfinite(rel)||!isfinite(m)) return;
    if(t < -60 || t > 0 || r < 1 || r > 20 || a < 0.1 || a > 200 || rel < 10 || rel > 2000 || m < -12 || m > 24) return;
    target_threshold=t; target_ratio=r; target_makeup=m; target_wet=bypass?0:1;
    attack=exp(-1/(a*0.001*rate)); release=exp(-1/(rel*0.001*rate));
}
void compressor_tick(float *left,float *right) {
    threshold+=(target_threshold-threshold)*smooth;
    ratio+=(target_ratio-ratio)*smooth;
    makeup+=(target_makeup-makeup)*smooth;
    wet+=(target_wet-wet)*smooth;
    double peak=fmax(fabs(*left),fabs(*right));
    double db=20*log10(fmax(peak,1e-12));
    double wanted=fmax(0,db-threshold)*(1-1/ratio);
    double coeff=wanted>reduction?attack:release;
    reduction=wanted+(reduction-wanted)*coeff;
    double gain=pow(10,(makeup-reduction)/20);
    double applied=1+wet*(gain-1);
    *left *= applied; *right *= applied;
}
