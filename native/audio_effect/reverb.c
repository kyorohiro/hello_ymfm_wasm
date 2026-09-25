/* Original Schroeder-style stereo reverb: four parallel damped combs,
 * then two serial all-pass diffusers per channel. Fixed storage, no allocation.
 * Room controls feedback, not seconds or physical room dimensions. */
#include <math.h>
#include <string.h>
#include "reverb.h"
#define MAX_DELAY 20000
static float comb[2][4][MAX_DELAY], diffuse[2][2][MAX_DELAY];
static float low[2][4];
static int cp[2][4], ap[2][2], cl[2][4], al[2][2];
static float mix, room, damp, targets[3], smoothing;
void reverb_clear(void) {
    memset(comb,0,sizeof comb); memset(diffuse,0,sizeof diffuse);
    memset(low,0,sizeof low); memset(cp,0,sizeof cp); memset(ap,0,sizeof ap);
}
void reverb_reset(double rate) {
    if (!isfinite(rate) || rate<16000 || rate>384000) rate=48000;
    const double delays[4]={0.0297,0.0371,0.0411,0.0437};
    for(int c=0;c<2;c++) {
        for(int j=0;j<4;j++) cl[c][j]=(int)((delays[j]+c*0.00073)*rate);
        al[c][0]=(int)((0.005+c*0.00031)*rate);
        al[c][1]=(int)((0.0017+c*0.00019)*rate);
    }
    mix=targets[0]=0; room=targets[1]=0.6f; damp=targets[2]=0.4f;
    smoothing=(float)(1-exp(-1/(0.02*rate)));
    reverb_clear();
}
void reverb_set(float m,float r,float d) {
    if(!isfinite(m)||!isfinite(r)||!isfinite(d)) return;
    targets[0]=fminf(1,fmaxf(0,m));
    targets[1]=fminf(1,fmaxf(0,r));
    targets[2]=fminf(1,fmaxf(0,d));
}
void reverb_tick(float *left,float *right) {
    mix+=(targets[0]-mix)*smoothing;
    room+=(targets[1]-room)*smoothing;
    damp+=(targets[2]-damp)*smoothing;
    float source=(*left+*right)*0.5f;
    float feedback=0.55f+0.39f*room, damping=0.85f*damp;
    for(int c=0;c<2;c++) {
        float wet=0;
        for(int j=0;j<4;j++) {
            int p=cp[c][j]; float v=comb[c][j][p];
            low[c][j]=v*(1-damping)+low[c][j]*damping;
            if(fabsf(low[c][j])<1e-20f) low[c][j]=0;
            comb[c][j][p]=source+feedback*low[c][j];
            cp[c][j]=(p+1==cl[c][j])?0:p+1;
            wet+=v*0.25f;
        }
        for(int j=0;j<2;j++) {
            int p=ap[c][j]; float delayed=diffuse[c][j][p];
            float y=delayed-0.5f*wet;
            diffuse[c][j][p]=wet+0.5f*y;
            ap[c][j]=(p+1==al[c][j])?0:p+1;
            wet=y;
        }
        float *out=c?right:left;
        *out=(*out)*(1-mix)+wet*mix;
    }
}
