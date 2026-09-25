/* Stereo-linked peak compressor, hard knee, no lookahead.
 * Attack/release smooth gain reduction in dB (time constants, not completion times).
 * Not a brick-wall limiter: transients can pass during attack. */
#include <math.h>
#include "compressor.h"
typedef struct { double rate, attack, release, smooth, threshold, ratio, makeup, wet, target_threshold, target_ratio, target_makeup, target_wet, reduction; } State;
static State instances[8];
static State *state = &instances[0];
int compressor_select(int slot) { if(slot<0 || slot>=8) return 0; state=&instances[slot]; return 1; }
void compressor_clear(void) { state->reduction=0; }
void compressor_reset(double sr) {
    if(isfinite(sr) && sr>=16000 && sr<=384000) state->rate=sr;
    state->threshold=state->target_threshold=-18; state->ratio=state->target_ratio=4;
    state->makeup=state->target_makeup=0; state->wet=state->target_wet=0;
    state->attack=exp(-1/(0.01*state->rate)); state->release=exp(-1/(0.15*state->rate));
    state->smooth=1-exp(-1/(0.01*state->rate));
    compressor_clear();
}
void compressor_set(float t,float r,float a,float rel,float m,int bypass) {
    if(!isfinite(t)||!isfinite(r)||!isfinite(a)||!isfinite(rel)||!isfinite(m)) return;
    if(t < -60 || t > 0 || r < 1 || r > 20 || a < 0.1 || a > 200 || rel < 10 || rel > 2000 || m < -12 || m > 24) return;
    state->target_threshold=t; state->target_ratio=r; state->target_makeup=m; state->target_wet=bypass?0:1;
    state->attack=exp(-1/(a*0.001*state->rate)); state->release=exp(-1/(rel*0.001*state->rate));
}
void compressor_tick(float *left,float *right) {
    state->threshold+=(state->target_threshold-state->threshold)*state->smooth;
    state->ratio+=(state->target_ratio-state->ratio)*state->smooth;
    state->makeup+=(state->target_makeup-state->makeup)*state->smooth;
    state->wet+=(state->target_wet-state->wet)*state->smooth;
    double peak=fmax(fabs(*left),fabs(*right));
    double db=20*log10(fmax(peak,1e-12));
    double wanted=fmax(0,db-state->threshold)*(1-1/state->ratio);
    double coeff=wanted>state->reduction?state->attack:state->release;
    state->reduction=wanted+(state->reduction-wanted)*coeff;
    double gain=pow(10,(state->makeup-state->reduction)/20);
    double applied=1+state->wet*(gain-1);
    *left *= applied; *right *= applied;
}
