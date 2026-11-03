/* Independent effect instances; preparation may allocate delay memory.
 * Processing never allocates. Own implementation; no Sonic Pi DSP copied. */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "extra_fx.h"
#define PI 3.14159265358979323846
#define TYPES 8
#define SLOTS 8
#define PARAMS 8
/* p[0..5] effect controls; p[6] mix; p[7] bypass. */
typedef struct {
    double p[PARAMS],target[PARAMS],phase,held[2],hold_phase;
    double c[5],z[2][2],previous[2],filter_state[2];
    float *delay; int capacity,position,prepared,coeff_count;
} FX;
static FX states[TYPES][SLOTS];
static double sr=48000, smoothing;
static const double defaults[TYPES][PARAMS]={
    {1200,0.707,0,0,0,0,1,1}, /* filter: cutoff, Q, type LP/HP/BP */
    {250,0.35,0,0,0,0,0.3,1}, /* delay: ms, feedback */
    {4,0,0,0,0,0,0.5,1}, /* distortion: drive */
    {8,8000,0,0,0,0,0.5,1}, /* bitcrusher: bits, sample/hold Hz */
    {800,2,2,0.707,0,0,1,1}, /* wobble: center Hz, depth octaves, LFO Hz, Q */
    {3,2,0.3,0.3,0,0,0.5,1}, /* flanger: base ms, depth ms, Hz, feedback */
    {2,0.5,0,0,0,0,1,1}, /* slicer: Hz, duty, minimum gain */
    {20,5,0.8,0,0,0,0.5,1} /* chorus: base ms, depth ms, Hz */
};
static int index_of(int type) { return type-7; }
static void clear_one(FX *f) {
    memset(f->z,0,sizeof f->z); memset(f->previous,0,sizeof f->previous);
    memset(f->filter_state,0,sizeof f->filter_state); memset(f->held,0,sizeof f->held);
    if(f->delay) memset(f->delay,0,sizeof(float)*f->capacity*2);
    f->position=0; f->phase=0; f->hold_phase=1; f->coeff_count=0;
}
void extra_reset(double rate) {
    if(isfinite(rate) && rate>=16000 && rate<=384000) sr=rate;
    smoothing=1-exp(-1/(sr*0.01));
    for(int t=0;t<TYPES;t++) for(int s=0;s<SLOTS;s++) {
        FX *f=&states[t][s]; free(f->delay); memset(f,0,sizeof *f);
        memcpy(f->p,defaults[t],sizeof f->p); memcpy(f->target,defaults[t],sizeof f->target);
        f->hold_phase=1;
    }
}
void extra_clear(void) {
    for(int t=0;t<TYPES;t++) for(int s=0;s<SLOTS;s++) clear_one(&states[t][s]);
}
int extra_prepare(int type,int slot) {
    int t=index_of(type); if(t<0||t>=TYPES||slot<0||slot>=SLOTS) return 0;
    FX *f=&states[t][slot];
    if(f->prepared) return 1;
    if(t==1 || t==5 || t==7) {
        int cap=(int)(sr*(t==1?2.01:0.105))+4;
        f->delay=calloc((size_t)cap*2,sizeof(float));
        if(!f->delay) return 0;
        f->capacity=cap;
    }
    f->prepared=1;return 1;
}
int extra_set(int type,int slot,int param,double value) {
    int t=index_of(type);
    if(t<0||t>=TYPES||slot<0||slot>=SLOTS||param<0||param>=PARAMS||!isfinite(value)) return 0;
    double lo=0,hi=0;
    if(param==6 || param==7) hi=1;
    else switch(t) {
    case 0: if(param==0){lo=20;hi=20000;} else if(param==1){lo=0.2;hi=12;} else if(param==2){hi=2;} else return 0; break;
    case 1: if(param==0){lo=1;hi=2000;} else if(param==1){hi=0.9;} else return 0; break;
    case 2: if(param==0){lo=1;hi=20;} else return 0; break;
    case 3: if(param==0){lo=2;hi=16;} else if(param==1){lo=100;hi=sr;} else return 0; break;
    case 4: if(param==0){lo=20;hi=10000;} else if(param==1){hi=4;} else if(param==2){lo=0.05;hi=20;} else if(param==3){lo=0.2;hi=8;} else return 0; break;
    case 5: if(param==0){lo=1;hi=15;} else if(param==1){hi=10;} else if(param==2){lo=0.05;hi=10;} else if(param==3){hi=0.9;} else return 0; break;
    case 6: if(param==0){lo=0.05;hi=30;} else if(param==1){lo=0.05;hi=0.95;} else if(param==2){hi=1;} else return 0; break;
    case 7: if(param==0){lo=10;hi=40;} else if(param==1){hi=10;} else if(param==2){lo=0.05;hi=10;} else return 0; break;
    }
    if(value<lo||value>hi || (t==0 && param==2 && floor(value)!=value)) return 0;
    if(!extra_prepare(type,slot)) return 0;
    states[t][slot].target[param]=value; return 1;
}
static double read_delay(FX *f,int ch,double samples) {
    samples=fmin(f->capacity-2,fmax(1,samples));
    double position=f->position-samples;
    if(position<0) position+=f->capacity;
    int a=(int)position,b=(a+1)%f->capacity;
    double fraction=position-a;
    return f->delay[ch*f->capacity+a]*(1-fraction)+f->delay[ch*f->capacity+b]*fraction;
}
static void coefficients(FX *f,double hz,double q,int kind) {
    hz=fmin(sr*0.45,fmax(20,hz));
    double w=2*PI*hz/sr,c=cos(w),alpha=sin(w)/(2*q),a=1+alpha;
    if(kind==0) {f->c[0]=(1-c)/2/a; f->c[1]=(1-c)/a; f->c[2]=f->c[0];}
    else if(kind==1) {f->c[0]=(1+c)/2/a; f->c[1]=-(1+c)/a; f->c[2]=f->c[0];}
    else {f->c[0]=alpha/a;f->c[1]=0;f->c[2]=-alpha/a;}
    f->c[3]=-2*c/a;f->c[4]=(1-alpha)/a;
}
static double filter(FX *f,int ch,double x) {
    double y=f->c[0]*x+f->z[ch][0];
    f->z[ch][0]=f->c[1]*x-f->c[3]*y+f->z[ch][1];
    f->z[ch][1]=f->c[2]*x-f->c[4]*y;
    if(fabs(f->z[ch][0])<1e-20) f->z[ch][0]=0;
    if(fabs(f->z[ch][1])<1e-20) f->z[ch][1]=0;
    return y;
}
void extra_tick(int type,int slot,float *left,float *right) {
    int t=index_of(type); FX *f=&states[t][slot];
    if(!f->prepared) return;
    for(int p=0;p<PARAMS;p++) f->p[p]+=(f->target[p]-f->p[p])*smoothing;
    double *p=f->p, x[2]={*left,*right}, y[2]={*left,*right};
    double lfo=sin(2*PI*f->phase);
    if(t==0 || t==4) {
        if(f->coeff_count--<=0) {
            coefficients(f,t==0?p[0]:p[0]*pow(2,p[1]*lfo),t==0?p[1]:p[3],t==0?(int)f->target[2]:0);
            f->coeff_count=15;
        }
        for(int c=0;c<2;c++) y[c]=filter(f,c,x[c]);
    } else if(t==1 || t==5 || t==7) {
        for(int c=0;c<2;c++) {
            double ms=p[0];
            if(t==5) ms+=p[1]*lfo;
            if(t==7) ms+=p[1]*sin(2*PI*(f->phase+c*0.25));
            y[c]=read_delay(f,c,ms*sr*0.001);
            double feedback=t==1?p[1]:t==5?p[3]:0;
            double v=x[c]+feedback*y[c];
            f->delay[c*f->capacity+f->position]=fabs(v)<1e-20?0:(float)v;
        }
        f->position=(f->position+1)%f->capacity;
    } else if(t==2) {
        /* Four interpolated substeps + two-pole lowpass before decimation.
         * Lightweight antialiasing, not identical to Web Audio oversampling. */
        double alpha=1-exp(-2*PI*0.1125);
        for(int c=0;c<2;c++) {
            for(int j=1;j<=4;j++) {
                double v=tanh(p[0]*(f->previous[c]+(x[c]-f->previous[c])*j/4));
                f->z[c][0]+=alpha*(v-f->z[c][0]);
                f->z[c][1]+=alpha*(f->z[c][0]-f->z[c][1]);
            }
            f->previous[c]=x[c]; y[c]=f->z[c][1];
        }
    } else if(t==3) {
        if(f->hold_phase>=1) {
            double steps=pow(2,round(p[0])-1);
            for(int c=0;c<2;c++) f->held[c]=round(fmin(1,fmax(-1,x[c]))*steps)/steps;
            f->hold_phase-=floor(f->hold_phase);
        }
        f->hold_phase+=fmin(sr,p[1])/sr;
        y[0]=f->held[0]; y[1]=f->held[1];
    } else if(t==6) {
        double target=f->phase<p[1]?1:p[2];
        double a=1-exp(-1/(sr*0.002));
        f->filter_state[0]+=(target-f->filter_state[0])*a;
        y[0]=x[0]*f->filter_state[0];y[1]=x[1]*f->filter_state[0];
    }
    double hz=t==4||t==5||t==7?p[2]:t==6?p[0]:0;
    f->phase+=hz/sr; f->phase-=floor(f->phase);
    double mix=p[6]*(1-p[7]);
    *left=(float)(x[0]+mix*(y[0]-x[0]));
    *right=(float)(x[1]+mix*(y[1]-x[1]));
}

/* Reuse a released controller slot without leaking a previous effect's tail. */
void extra_reset_slot(int type,int slot) {
    int t=index_of(type); if(t<0||t>=TYPES||slot<0||slot>=SLOTS)return;
    FX *f=&states[t][slot]; clear_one(f);
    memcpy(f->p,defaults[t],sizeof f->p); memcpy(f->target,defaults[t],sizeof f->target);
}
