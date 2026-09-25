/* Bounded PCM banks/voices. Allocation occurs only when loading a bank. */
#include <stdlib.h>
#include <string.h>
#include <math.h>
#define BANKS 64
#define VOICES 64
#define PI 3.14159265358979323846
extern float *gain_input(void);
extern int gain_capacity(void);
typedef struct {float *pcm;int frames,channels;double rate;} Bank;
typedef struct {int active,bank,loop,stopping;double pos,step,end,loopStart,loopEnd,gain,pan,age,fadeIn,fadeOut,stopAge,stopGain,travel,limit;} Voice;
static Bank banks[BANKS];static Voice voices[VOICES];static double rate=48000;
void sample_clear(void){memset(voices,0,sizeof voices);}
void sample_unload(int bank){if(bank<0||bank>=BANKS)return;for(int i=0;i<VOICES;i++)if(voices[i].bank==bank)voices[i].active=0;free(banks[bank].pcm);memset(&banks[bank],0,sizeof(Bank));}
void sample_reset(double sr){sample_clear();for(int i=0;i<BANKS;i++)sample_unload(i);if(sr>0)rate=sr;}
float *sample_allocate(int slot,int frames,int channels,double sr){
 if(slot<0||slot>=BANKS||frames<1||frames>10000000||(channels!=1&&channels!=2)||!isfinite(sr)||sr<=0)return NULL;
 float *pcm=malloc((size_t)frames*channels*sizeof(float));if(!pcm)return NULL;
 sample_unload(slot);banks[slot]=(Bank){pcm,frames,channels,sr};return pcm;
}
int sample_play(int slot,int bank,double speed,double gain,double pan,double offset,double duration,int loop,double loopStart,double loopEnd,double fadeIn,double fadeOut){
 if(slot<0||slot>=VOICES||bank<0||bank>=BANKS||!banks[bank].pcm||!isfinite(speed)||speed<=0)return 0;
 if(!isfinite(gain)||!isfinite(pan)||!isfinite(offset)||offset<0||!isfinite(duration)||duration< -1||!isfinite(loopStart)||loopStart<0||!isfinite(loopEnd)||loopEnd<0||!isfinite(fadeIn)||fadeIn<0||!isfinite(fadeOut)||fadeOut<0)return 0;
 Bank *b=&banks[bank];Voice *v=&voices[slot];memset(v,0,sizeof *v);
 v->active=1;v->bank=bank;v->pos=offset*b->rate;v->step=speed*b->rate/rate;v->end=b->frames;
 v->gain=gain;v->pan=fmax(-1,fmin(1,pan));v->loop=loop;v->loopStart=fmin(b->frames,loopStart*b->rate);v->loopEnd=loopEnd>0?fmin(b->frames,loopEnd*b->rate):b->frames;
 if(v->loopEnd<=v->loopStart){v->loopStart=0;v->loopEnd=b->frames;}
 if(loop&&v->pos>=v->loopEnd)v->pos=v->loopStart;
 v->fadeIn=fadeIn*rate;v->fadeOut=fadeOut*rate;v->limit=duration<0?-1:duration*b->rate;
 return 1;
}
int sample_active(int slot){return slot>=0&&slot<VOICES&&voices[slot].active;}
void sample_stop(int slot){if(slot<0||slot>=VOICES)return;Voice *v=&voices[slot];if(!v->active||v->stopping)return;v->stopping=1;v->stopGain=v->fadeIn>0?fmin(1,v->age/v->fadeIn):1;if(v->fadeOut<=0)v->active=0;}
static double read(Bank *b,int ch,int index){return b->pcm[ch*b->frames+index];}
void sample_mix(int frames){
 int cap=gain_capacity();if(frames<0||frames>cap)return;float *out=gain_input();
 for(int s=0;s<VOICES;s++){Voice *v=&voices[s];if(!v->active)continue;Bank *b=&banks[v->bank];
 double angle=b->channels==1?(v->pan+1)*PI/4:v->pan<0?(v->pan+1)*PI/2:v->pan*PI/2;
 double pc=cos(angle),ps=sin(angle);
 for(int i=0;i<frames;i++){
  if(v->loop&&v->pos>=v->loopEnd)v->pos=v->loopStart+fmod(v->pos-v->loopStart,v->loopEnd-v->loopStart);
  if(v->pos>=v->end||(v->limit>=0&&v->travel>=v->limit)||(v->stopping&&v->stopAge>=v->fadeOut)){v->active=0;break;}
  int index=(int)v->pos,next=index+1;double fraction=v->pos-index;
  if(v->loop&&next>=v->loopEnd)next=(int)v->loopStart;else if(next>=b->frames)next=index;
  double l=read(b,0,index)*(1-fraction)+read(b,0,next)*fraction;
  double r=b->channels==2?read(b,1,index)*(1-fraction)+read(b,1,next)*fraction:l;
  double env=v->stopping?v->stopGain*(1-v->stopAge/v->fadeOut):v->fadeIn>0?fmin(1,v->age/v->fadeIn):1;
  if(b->channels==1){l*=pc;r*=ps;}
  else if(v->pan<0){l+=r*pc;r*=ps;}
  else {r+=l*ps;l*=pc;}
  out[i]+=(float)(l*v->gain*env);out[cap+i]+=(float)(r*v->gain*env);
  v->pos+=v->step;v->travel+=v->step;v->age++;if(v->stopping)v->stopAge++;
 }
 }
}
