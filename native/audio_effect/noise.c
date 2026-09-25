/* Continuous noise voices, mixed before the FX graph. No render-time allocation. */
#include <math.h>
#include <stdint.h>
#include <string.h>
#define VOICES 32
#define PI 3.14159265358979323846
extern float *gain_input(void);
extern int gain_capacity(void);
typedef struct { double value,target,step; int remaining; } Param;
typedef struct {
 int used,type,active,releasing,mode; uint32_t rng;
 Param p[6],env; /* gain, pan, cutoff, Q, attack, release */
 double pink[7],brown,previous,z1,z2,b0,b1,b2,a1,a2,left,right;
} Voice;
static Voice voices[VOICES];
static double rate=48000;
static void ramp(Param *p,double value,int frames){p->target=value;p->remaining=frames;if(frames>0)p->step=(value-p->value)/frames;else p->value=value;}
static double tick(Param *p){if(p->remaining>0){p->value+=p->step;if(--p->remaining==0)p->value=p->target;}return p->value;}
static void coefficients(Voice *v){
 double f=fmin(v->p[2].value,rate*.49),q=fmax(.0001,v->p[3].value);
 double w=2*PI*f/rate,c=cos(w),alpha=sin(w)/(2*q),a0=1+alpha;
 double b0=(1-c)/2,b1=1-c,b2=b0;
 if(v->mode==1){b0=(1+c)/2;b1=-(1+c);b2=b0;}
 if(v->mode==2){b0=alpha;b1=0;b2=-alpha;}
 if(v->mode==3){b0=1;b1=-2*c;b2=1;}
 if(v->mode==4){b0=1-alpha;b1=-2*c;b2=1+alpha;}
 if(v->mode>=5){b0=1;b1=0;b2=0;a0=1;v->a1=v->a2=0;}
 else {v->a1=-2*c/a0;v->a2=(1-alpha)/a0;}
 v->b0=b0/a0;v->b1=b1/a0;v->b2=b2/a0;
}
void noise_reset(double sr){if(isfinite(sr)&&sr>0)rate=sr;memset(voices,0,sizeof voices);}
int noise_create(int slot,int type,unsigned seed){
 if(slot<0||slot>=VOICES||type<0||type>4)return 0;
 Voice *v=&voices[slot];memset(v,0,sizeof *v);v->used=1;v->type=type;v->rng=seed?seed:slot+1;
 double defaults[]={.3,0,1600,.2,0,0};for(int i=0;i<6;i++)ramp(&v->p[i],defaults[i],0);coefficients(v);v->left=v->right=.7071067811865476;return 1;
}
int noise_set(int slot,int param,double value,int frames){
 static const double lo[]={0,-1,10,.0001,0,0},hi[]={8,1,20000,1000,60,60};
 if(slot<0||slot>=VOICES||param<0||param>=6||!isfinite(value)||value<lo[param]||value>hi[param]||frames<0)return 0;
 Voice *v=&voices[slot];if(!v->used)return 0;ramp(&v->p[param],value,frames);if(param==2||param==3)coefficients(v);if(param==1){double angle=(v->p[1].value+1)*PI/4;v->left=cos(angle);v->right=sin(angle);}return 1;
}
void noise_filter(int slot,int mode){if(slot<0||slot>=VOICES||mode<0||mode>7)return;voices[slot].mode=mode;coefficients(&voices[slot]);}
/* 0=start, 1=release, 2=dispose */
void noise_action(int slot,int action){
 if(slot<0||slot>=VOICES)return;Voice *v=&voices[slot];if(!v->used)return;
 if(action==2){memset(v,0,sizeof *v);return;}
 if(action==0){if(v->active&&!v->releasing)return;v->active=1;v->releasing=0;ramp(&v->env,1,(int)(v->p[4].value*rate));}
 if(action==1&&v->active){v->releasing=1;ramp(&v->env,0,(int)(v->p[5].value*rate));}
}
static double next(Voice *v){
 uint32_t x=v->rng;x^=x<<13;x^=x>>17;x^=x<<5;v->rng=x;double w=(double)x/2147483648.0-1;
 if(v->type==1){double *b=v->pink;b[0]=.99886*b[0]+w*.0555179;b[1]=.99332*b[1]+w*.0750759;b[2]=.969*b[2]+w*.153852;b[3]=.8665*b[3]+w*.3104856;b[4]=.55*b[4]+w*.5329522;b[5]=-.7616*b[5]-w*.016898;double y=(b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*.5362)*.11;b[6]=w*.115926;return y;}
 if(v->type==2){v->brown=(v->brown+.02*w)/1.02;return v->brown*3.5;}
 if(v->type==3){double y=(w-v->previous*.985)*.75;v->previous=w;return y;}
 if(v->type==4)return w>.2?1:w<-.2?-1:0;
 return w;
}
void noise_mix(int frames){
 int cap=gain_capacity();if(frames<0||frames>cap)return;float *out=gain_input();
 for(int s=0;s<VOICES;s++){Voice *v=&voices[s];if(!v->used)continue;
 for(int i=0;i<frames;i++){
  int changing=v->p[2].remaining||v->p[3].remaining,pan=v->p[1].remaining;
  for(int p=0;p<6;p++)tick(&v->p[p]);
  if(changing)coefficients(v);
  if(pan){double angle=(v->p[1].value+1)*PI/4;v->left=cos(angle);v->right=sin(angle);}
  double env=tick(&v->env);
  if(v->releasing&&v->env.remaining==0){v->active=0;v->z1=v->z2=0;}
  if(!v->active)continue;
  double x=next(v),y=v->b0*x+v->z1;v->z1=v->b1*x-v->a1*y+v->z2;v->z2=v->b2*x-v->a2*y;
  double g=y*v->p[0].value*env;
  out[i]+=(float)(g*v->left);out[cap+i]+=(float)(g*v->right);
 }
 }
}
