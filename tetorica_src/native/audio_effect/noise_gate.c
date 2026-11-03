/* Stereo linked gate. Peak follower (instant attack, 10ms decay) avoids
 * closing on individual zero crossings. Hysteresis + hold govern the switch;
 * attack/release smooth its gain. No allocation, no lookahead. */
#include <math.h>
#include "noise_gate.h"
typedef struct { double rate,detector_decay,smooth,attack,release,level,gain,wet,target_wet,threshold,target_threshold,hysteresis,target_hysteresis; int opened,hold_frames,remaining; } State;
static State instances[8];
static State *state = &instances[0];
int gate_select(int slot) { if(slot<0 || slot>=8) return 0; state=&instances[slot]; return 1; }
void gate_clear(void) { state->level=0; state->gain=0; state->opened=0; state->remaining=0; }
void gate_reset(double sr) {
    if(isfinite(sr) && sr>=16000 && sr<=384000) state->rate=sr;
    state->detector_decay=exp(-1/(0.01*state->rate)); state->smooth=1-exp(-1/(0.01*state->rate));
    state->attack=exp(-1/(0.005*state->rate)); state->release=exp(-1/(0.1*state->rate));
    state->threshold=state->target_threshold=-40; state->hysteresis=state->target_hysteresis=6;
    state->hold_frames=(int)(state->rate*0.05); state->wet=state->target_wet=0;
    gate_clear();
}
void gate_set(float t,float h,float a,float hold,float rel,int bypass) {
    if(!isfinite(t)||!isfinite(h)||!isfinite(a)||!isfinite(hold)||!isfinite(rel)) return;
    if(t < -80 || t > 0 || h < 0 || h > 24 || a < 0.1 || a > 200 || hold < 0 || hold > 1000 || rel < 10 || rel > 2000) return;
    state->target_threshold=t; state->target_hysteresis=h; state->target_wet=bypass?0:1;
    state->attack=exp(-1/(a*0.001*state->rate)); state->release=exp(-1/(rel*0.001*state->rate));
    state->hold_frames=(int)(hold*0.001*state->rate);
    if(state->remaining>state->hold_frames) state->remaining=state->hold_frames;
}
void gate_tick(float *left,float *right) {
    state->threshold+=(state->target_threshold-state->threshold)*state->smooth;
    state->hysteresis+=(state->target_hysteresis-state->hysteresis)*state->smooth;
    state->wet+=(state->target_wet-state->wet)*state->smooth;
    double peak=fmax(fabs(*left),fabs(*right));
    state->level=fmax(peak,state->level*state->detector_decay);
    if(state->level<1e-20) state->level=0;
    double db=20*log10(fmax(state->level,1e-12));
    if(!state->opened && db>=state->threshold) state->opened=1;
    if(state->opened) {
        if(db>=state->threshold-state->hysteresis) state->remaining=state->hold_frames;
        else if(state->remaining>0) --state->remaining;
        else state->opened=0;
    }
    double desired=state->opened?1:0;
    double coeff=state->opened?state->attack:state->release;
    state->gain=desired+(state->gain-desired)*coeff;
    if(state->gain<1e-20) state->gain=0;
    double applied=1+state->wet*(state->gain-1);
    *left *= applied; *right *= applied;
}
