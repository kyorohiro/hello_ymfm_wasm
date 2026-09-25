/* Stereo PCM gain proof of concept. No allocation on the audio thread. */
#include <math.h>
#include "reverb.h"
#include "compressor.h"
#include "noise_gate.h"
#define CAPACITY 2048
static float input[CAPACITY * 2];
static float output[CAPACITY * 2];
static float current = 1.0f, target = 1.0f, step = 0.0f;
static int remaining = 0;
float *gain_input(void) { return input; }
float *gain_output(void) { return output; }
int gain_capacity(void) { return CAPACITY; }
void eq_reset(double sample_rate);
void gain_reset(void) { eq_reset(48000); reverb_reset(48000); compressor_reset(48000); gate_reset(48000); current = target = 1.0f; step = 0; remaining = 0; }
void gain_set(float value, int ramp_frames) {
    if (!(value >= 0.0f && value <= 2.0f)) return;
    target = value;
    remaining = ramp_frames > 0 ? ramp_frames : 0;
    if (remaining) step = (target - current) / remaining;
    else current = target;
}
/* RBJ biquads: low shelf 200 Hz, peak 1 kHz Q=0.707, high shelf 4 kHz.
 * Normalized coefficients ramp over 10 ms; each stereo channel has its own state.
 */
typedef struct {
    double c[5], goal[5], delta[5], z[2][2];
    int ramp;
} Biquad;
static Biquad eq[3];
static double rate = 48000;
void eq_reset(double sample_rate) {
    if (isfinite(sample_rate) && sample_rate >= 16000 && sample_rate <= 384000) rate = sample_rate;
    for (int b=0; b<3; b++) {
        eq[b] = (Biquad){0};
        eq[b].c[0] = eq[b].goal[0] = 1;
    }
}
void eq_set(int band, double db) {
    if (band < 0 || band > 2 || !isfinite(db) || db < -12 || db > 12) return;
    double f = band == 0 ? 200 : band == 1 ? 1000 : 4000;
    double w = 6.283185307179586 * f / rate;
    double co = cos(w), si = sin(w), A = pow(10, db/40);
    double alpha = si / sqrt(2.0), k = 2 * sqrt(A) * alpha;
    double b0,b1,b2,a0,a1,a2;
    if (band == 1) {
        b0=1+alpha*A; b1=-2*co; b2=1-alpha*A;
        a0=1+alpha/A; a1=-2*co; a2=1-alpha/A;
    } else if (band == 0) {
        b0=A*((A+1)-(A-1)*co+k); b1=2*A*((A-1)-(A+1)*co); b2=A*((A+1)-(A-1)*co-k);
        a0=(A+1)+(A-1)*co+k; a1=-2*((A-1)+(A+1)*co); a2=(A+1)+(A-1)*co-k;
    } else {
        b0=A*((A+1)+(A-1)*co+k); b1=-2*A*((A-1)+(A+1)*co); b2=A*((A+1)+(A-1)*co-k);
        a0=(A+1)-(A-1)*co+k; a1=2*((A-1)-(A+1)*co); a2=(A+1)-(A-1)*co-k;
    }
    double values[5]={b0/a0,b1/a0,b2/a0,a1/a0,a2/a0};
    Biquad *q=&eq[band];
    q->ramp=(int)(rate*0.01);
    for(int j=0;j<5;j++) { q->goal[j]=values[j]; q->delta[j]=(values[j]-q->c[j])/q->ramp; }
}
static double eq_tick(int ch, double x) {
    for(int b=0;b<3;b++) {
        Biquad *q=&eq[b];
        double y=q->c[0]*x+q->z[ch][0];
        q->z[ch][0]=q->c[1]*x-q->c[3]*y+q->z[ch][1];
        q->z[ch][1]=q->c[2]*x-q->c[4]*y;
        x=y;
    }
    return x;
}
void gain_process(int frames) {
    if (frames < 0 || frames > CAPACITY) return;
    for (int i = 0; i < frames; ++i) {
        if (remaining > 0) { current += step; if (--remaining == 0) current = target; }
        for(int b=0;b<3;b++) {
            Biquad *q=&eq[b];
            if(q->ramp > 0) {
                --q->ramp;
                for(int j=0;j<5;j++) q->c[j]=q->ramp ? q->c[j]+q->delta[j] : q->goal[j];
            }
        }
        output[i] = (float)eq_tick(0, input[i] * current);
        output[CAPACITY+i] = (float)eq_tick(1, input[CAPACITY+i] * current);
        gate_tick(&output[i], &output[CAPACITY+i]);
        compressor_tick(&output[i], &output[CAPACITY+i]);
        reverb_tick(&output[i], &output[CAPACITY+i]);
    }
}
