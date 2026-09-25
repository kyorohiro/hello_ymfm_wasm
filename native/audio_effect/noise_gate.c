/* Stereo linked gate. Peak follower (instant attack, 10ms decay) avoids
 * closing on individual zero crossings. Hysteresis + hold govern the switch;
 * attack/release smooth its gain. No allocation, no lookahead. */
#include <math.h>
#include "noise_gate.h"
static double rate=48000, detector_decay, smooth, attack, release;
static double level, gain, wet, target_wet, threshold, target_threshold, hysteresis, target_hysteresis;
static int opened, hold_frames, remaining;
void gate_clear(void) { level=0; gain=0; opened=0; remaining=0; }
void gate_reset(double sr) {
    if(isfinite(sr) && sr>=16000 && sr<=384000) rate=sr;
    detector_decay=exp(-1/(0.01*rate)); smooth=1-exp(-1/(0.01*rate));
    attack=exp(-1/(0.005*rate)); release=exp(-1/(0.1*rate));
    threshold=target_threshold=-40; hysteresis=target_hysteresis=6;
    hold_frames=(int)(rate*0.05); wet=target_wet=0;
    gate_clear();
}
void gate_set(float t,float h,float a,float hold,float rel,int bypass) {
    if(!isfinite(t)||!isfinite(h)||!isfinite(a)||!isfinite(hold)||!isfinite(rel)) return;
    if(t < -80 || t > 0 || h < 0 || h > 24 || a < 0.1 || a > 200 || hold < 0 || hold > 1000 || rel < 10 || rel > 2000) return;
    target_threshold=t; target_hysteresis=h; target_wet=bypass?0:1;
    attack=exp(-1/(a*0.001*rate)); release=exp(-1/(rel*0.001*rate));
    hold_frames=(int)(hold*0.001*rate);
    if(remaining>hold_frames) remaining=hold_frames;
}
void gate_tick(float *left,float *right) {
    threshold+=(target_threshold-threshold)*smooth;
    hysteresis+=(target_hysteresis-hysteresis)*smooth;
    wet+=(target_wet-wet)*smooth;
    double peak=fmax(fabs(*left),fabs(*right));
    level=fmax(peak,level*detector_decay);
    if(level<1e-20) level=0;
    double db=20*log10(fmax(level,1e-12));
    if(!opened && db>=threshold) opened=1;
    if(opened) {
        if(db>=threshold-hysteresis) remaining=hold_frames;
        else if(remaining>0) --remaining;
        else opened=0;
    }
    double desired=opened?1:0;
    double coeff=opened?attack:release;
    gain=desired+(gain-desired)*coeff;
    if(gain<1e-20) gain=0;
    double applied=1+wet*(gain-1);
    *left *= applied; *right *= applied;
}
