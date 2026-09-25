#include <math.h>
/* RBJ biquads: low shelf 200 Hz, peak 1 kHz Q=0.707, high shelf 4 kHz.
 * Normalized coefficients ramp over 10 ms; each stereo channel has its own state.
 */
typedef struct {
    double c[5], goal[5], delta[5], z[2][2];
    int ramp;
} Biquad;
typedef struct { Biquad eq[3]; double rate; } State;
static State instances[8];
static State *state = &instances[0];
int eq_select(int slot) { if(slot<0 || slot>=8) return 0; state=&instances[slot]; return 1; }
void eq_reset(double sample_rate) {
    if (isfinite(sample_rate) && sample_rate >= 16000 && sample_rate <= 384000) state->rate = sample_rate;
    for (int b=0; b<3; b++) {
        state->eq[b] = (Biquad){0};
        state->eq[b].c[0] = state->eq[b].goal[0] = 1;
    }
}
void eq_set(int band, double db) {
    if (band < 0 || band > 2 || !isfinite(db) || db < -12 || db > 12) return;
    double f = band == 0 ? 200 : band == 1 ? 1000 : 4000;
    double w = 6.283185307179586 * f / state->rate;
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
    Biquad *q=&state->eq[band];
    q->ramp=(int)(state->rate*0.01);
    for(int j=0;j<5;j++) { q->goal[j]=values[j]; q->delta[j]=(values[j]-q->c[j])/q->ramp; }
}
static double eq_channel(int ch, double x) {
    for(int b=0;b<3;b++) {
        Biquad *q=&state->eq[b];
        double y=q->c[0]*x+q->z[ch][0];
        q->z[ch][0]=q->c[1]*x-q->c[3]*y+q->z[ch][1];
        q->z[ch][1]=q->c[2]*x-q->c[4]*y;
        x=y;
    }
    return x;
}
void eq_tick(float *left,float *right) {
        for(int b=0;b<3;b++) {
            Biquad *q=&state->eq[b];
            if(q->ramp > 0) {
                --q->ramp;
                for(int j=0;j<5;j++) q->c[j]=q->ramp ? q->c[j]+q->delta[j] : q->goal[j];
            }
        }
    *left=(float)eq_channel(0,*left); *right=(float)eq_channel(1,*right);
}
void eq_clear(void) { for(int b=0;b<3;b++) for(int c=0;c<2;c++) state->eq[b].z[c][0]=state->eq[b].z[c][1]=0; }
