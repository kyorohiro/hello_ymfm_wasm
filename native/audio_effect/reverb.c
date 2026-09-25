/* Original Schroeder-style stereo reverb: four parallel damped combs,
 * then two serial all-pass diffusers per channel. Fixed storage, no allocation.
 * Room controls feedback, not seconds or physical room dimensions. */
#include <math.h>
#include <string.h>
#include "reverb.h"
#define MAX_DELAY 20000
typedef struct { float comb[2][4][MAX_DELAY], diffuse[2][2][MAX_DELAY], low[2][4]; int cp[2][4], ap[2][2], cl[2][4], al[2][2]; float mix, room, damp, targets[3], smoothing; } State;
static State instances[8];
static State *state = &instances[0];
int reverb_select(int slot) { if(slot<0 || slot>=8) return 0; state=&instances[slot]; return 1; }
void reverb_clear(void) {
    memset(state->comb,0,sizeof state->comb); memset(state->diffuse,0,sizeof state->diffuse);
    memset(state->low,0,sizeof state->low); memset(state->cp,0,sizeof state->cp); memset(state->ap,0,sizeof state->ap);
}
void reverb_reset(double rate) {
    if (!isfinite(rate) || rate<16000 || rate>384000) rate=48000;
    const double delays[4]={0.0297,0.0371,0.0411,0.0437};
    for(int c=0;c<2;c++) {
        for(int j=0;j<4;j++) state->cl[c][j]=(int)((delays[j]+c*0.00073)*rate);
        state->al[c][0]=(int)((0.005+c*0.00031)*rate);
        state->al[c][1]=(int)((0.0017+c*0.00019)*rate);
    }
    state->mix=state->targets[0]=0; state->room=state->targets[1]=0.6f; state->damp=state->targets[2]=0.4f;
    state->smoothing=(float)(1-exp(-1/(0.02*rate)));
    reverb_clear();
}
void reverb_set(float m,float r,float d) {
    if(!isfinite(m)||!isfinite(r)||!isfinite(d)) return;
    state->targets[0]=fminf(1,fmaxf(0,m));
    state->targets[1]=fminf(1,fmaxf(0,r));
    state->targets[2]=fminf(1,fmaxf(0,d));
}
void reverb_tick(float *left,float *right) {
    state->mix+=(state->targets[0]-state->mix)*state->smoothing;
    state->room+=(state->targets[1]-state->room)*state->smoothing;
    state->damp+=(state->targets[2]-state->damp)*state->smoothing;
    float source=(*left+*right)*0.5f;
    float feedback=0.55f+0.39f*state->room, damping=0.85f*state->damp;
    for(int c=0;c<2;c++) {
        float wet=0;
        for(int j=0;j<4;j++) {
            int p=state->cp[c][j]; float v=state->comb[c][j][p];
            state->low[c][j]=v*(1-damping)+state->low[c][j]*damping;
            if(fabsf(state->low[c][j])<1e-20f) state->low[c][j]=0;
            state->comb[c][j][p]=source+feedback*state->low[c][j];
            state->cp[c][j]=(p+1==state->cl[c][j])?0:p+1;
            wet+=v*0.25f;
        }
        for(int j=0;j<2;j++) {
            int p=state->ap[c][j]; float delayed=state->diffuse[c][j][p];
            float y=delayed-0.5f*wet;
            state->diffuse[c][j][p]=wet+0.5f*y;
            state->ap[c][j]=(p+1==state->al[c][j])?0:p+1;
            wet=y;
        }
        float *out=c?right:left;
        *out=(*out)*(1-state->mix)+wet*state->mix;
    }
}
