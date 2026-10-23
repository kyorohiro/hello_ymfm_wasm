// Copyright 2026 Tetorica contributors.
// JSNES portions: Copyright JSNES contributors, Apache-2.0.
// FDS portions: Copyright (C) 2017-2020 FIX94, MIT.
// SPDX-License-Identifier: Apache-2.0 AND MIT
// Direct C++ port of the pinned JSNES/Tetorica NES APU and MIT fixNES FDS
// JavaScript adaptation. See the accompanying provenance and license notices.
#include "nes_core.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <new>
namespace {
  int32_t i32(double value) {
    if (!std::isfinite(value) || value == 0) return 0;
    double n = std::fmod(std::trunc(value), 4294967296.0);
    if (n < 0) n += 4294967296.0;
    return n < 2147483648.0 ? static_cast<int32_t>(n) : static_cast<int32_t>(static_cast<int64_t>(n) - 4294967296LL);
  }
  int32_t shr(double value, unsigned bits) {
    return i32(value) >> (bits & 31);
  }
  int32_t shl(double value, unsigned bits) {
    uint32_t n = static_cast<uint32_t>(i32(value)) << (bits & 31);
    return n <= 0x7fffffffU ? static_cast<int32_t>(n) : static_cast<int32_t>(static_cast<int64_t>(n) - 4294967296LL);
  }
  constexpr int LENGTH[32] = {
    10,254,20,2,40,4,80,6,160,8,60,10,14,12,26,14,12,16,24,18,48,20,96,22,192,24,72,26,16,28,32,30
  };
  constexpr int DUTY[32] = {
    0,1,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1,1,1,1,0,0,0,1,0,0,1,1,1,1,1
  };
  constexpr int DMC_NTSC[16] = {
    0xd60,0xbe0,0xaa0,0xa00,0x8f0,0x7f0,0x710,0x6b0,0x5f0,0x500,0x470,0x400,0x350,0x2a0,0x240,0x1b0
  };
  constexpr int DMC_PAL[16] = {
    398*8,354*8,316*8,298*8,276*8,236*8,210*8,198*8,176*8,148*8,132*8,118*8,98*8,78*8,66*8,50*8
  };
  constexpr int NOISE_NTSC[16] = {
    4,8,16,32,64,96,128,160,202,254,380,508,762,1016,2034,4068
  };
  constexpr int NOISE_PAL[16] = {
    4,8,14,30,60,88,118,148,188,236,354,472,708,944,1890,3778
  };
  struct Apu;
  struct Square {
    bool sqr1, enabled=false, lengthEnable=false, sweepActive=false, sweepCarry=false;
    bool envDisable=false, envLoop=false, envReset=false, updateSweep=false;
    int timer=0, period=0, length=0, counter=0, sweepCounter=0, sweepPeriod=0;
    int sweepMode=0, sweepShift=0, envRate=0, envCounter=0, envVolume=0, volume=0, duty=0, sample=0;
    explicit Square(bool first=false):sqr1(first) {
    }
    void update() {
      if (enabled && length > 0 && period > 7) {
        if (sweepMode == 0 && period + (period >> sweepShift) > 0x7ff) sample=0;
        else sample=volume*DUTY[(duty<<3)+counter];
      } else sample=0;
    }
    void setEnabled(bool v) {
      enabled=v;
      if(!v)length=0;
      update();
    }
    void lengthClock() {
      if(lengthEnable && length>0) {
        --length;
        if(length==0)update();
      }
    }
    void envClock() {
      if(envReset) {
        envReset=false;
        envCounter=envRate+1;
        envVolume=15;
      } else if(--envCounter<=0) {
        envCounter=envRate+1;
        if(envVolume>0)--envVolume;
        else envVolume=envLoop?15:0;
      }
      volume=envDisable?envRate:envVolume;
      update();
    }
    void sweepClock() {
      if(--sweepCounter<=0) {
        sweepCounter=sweepPeriod+1;
        if(sweepActive&&sweepShift>0&&period>7) {
          sweepCarry=false;
          if(sweepMode==0) {
            period+=period>>sweepShift;
            if(period>0x7ff) {
              period=4095;
              sweepCarry=true;
            }
          } else period-=((period>>sweepShift)+(sqr1?1:0));
        }
      }
      if(updateSweep) {
        updateSweep=false;
        sweepCounter=sweepPeriod+1;
      }
    }
    void write(int address,int value) {
      int add=sqr1?0:4;
      if(address==0x4000+add) {
        envDisable=(value&16)!=0;
        envRate=value&15;
        envLoop=(value&32)!=0;
        duty=(value>>6)&3;
        lengthEnable=(value&32)==0;
        volume=envDisable?envRate:envVolume;
        update();
      } else if(address==0x4001+add) {
        sweepActive=(value&128)!=0;
        sweepPeriod=(value>>4)&7;
        sweepMode=(value>>3)&1;
        sweepShift=value&7;
        updateSweep=true;
      } else if(address==0x4002+add) {
        period=(period&0x700)|value;
      } else if(address==0x4003+add) {
        period=(period&255)|((value&7)<<8);
        if(enabled)length=LENGTH[(value&248)>>3];
        envReset=true;
      }
    }
  };
  struct Triangle {
    int timer=0,period=0,counter=0,length=0,linear=0,reload=0,sample=15;
    bool enabled=false,condition=false,lengthEnable=false,halt=true,control=false;
    void update() {
      condition=enabled&&period>7&&linear>0&&length>0;
    }
    void setEnabled(bool value) {
      enabled=value;
      if(!value)length=0;
      update();
    }
    void lengthClock() {
      if(lengthEnable&&length>0) {
        --length;
        if(length==0)update();
      }
    }
    void linearClock() {
      if(halt) {
        linear=reload;
        update();
      } else if(linear>0) {
        --linear;
        update();
      }
      if(!control)halt=false;
    }
    void write(int address,int value) {
      if(address==0x4008) {
        control=(value&128)!=0;
        reload=value&127;
        lengthEnable=!control;
      } else if(address==0x400a)period=(period&0x700)|value;
      else if(address==0x400b) {
        period=(period&255)|((value&7)<<8);
        if(enabled)length=LENGTH[(value&248)>>3];
        halt=true;
      }
      update();
    }
  };
  struct Noise {
    int timer=0,period=0,length=0,envRate=0,envCounter=0,envVolume=0,volume=0;
    uint32_t shift=1;
    int randomBit=0,mode=0,sample=0,accValue=0,accCount=1;
    bool enabled=false,lengthEnable=false,envDisable=false,envLoop=false,envReset=false;
    void update() {
      if(enabled&&length>0)sample=randomBit*volume;
    }
    void setEnabled(bool v) {
      enabled=v;
      if(!v)length=0;
      update();
    }
    void lengthClock() {
      if(lengthEnable&&length>0) {
        --length;
        if(length==0)update();
      }
    }
    void envClock() {
      if(envReset) {
        envReset=false;
        envCounter=envRate+1;
        envVolume=15;
      } else if(--envCounter<=0) {
        envCounter=envRate+1;
        if(envVolume>0)--envVolume;
        else envVolume=envLoop?15:0;
      }
      volume=envDisable?envRate:envVolume;
      update();
    }
    void write(int address,int value,const int *table) {
      if(address==0x400c) {
        envDisable=(value&16)!=0;
        envRate=value&15;
        envLoop=(value&32)!=0;
        lengthEnable=(value&32)==0;
        volume=envDisable?envRate:envVolume;
      } else if(address==0x400e) {
        period=table[value&15];
        mode=value>>7;
      } else if(address==0x400f) {
        if(enabled)length=LENGTH[(value&248)>>3];
        envReset=true;
      }
    }
  };
  struct Dmc {
    std::array<uint8_t,65536> *memory=nullptr;
    bool enabled=false,hasSample=false,irq=false;
    int mode=0,frequency=0,dmaCounter=0,delta=0,start=0,address=0,length=0,remaining=0;
    int sample=0,lsb=0,shiftCounter=0,reg4012=0,reg4013=0,data=0,lastFetched=0;
    void next() {
      data=(*memory)[address&65535];
      lastFetched=data;
      --remaining;
      ++address;
      if(address>65535)address=0x8000;
      hasSample=true;
    }
    void end() {
      if(remaining==0&&mode==1) {
        address=start;
        remaining=length;
      }
      if(remaining>0) {
        next();
        if(remaining==0&&mode==2)irq=true;
      }
    }
    void clock() {
      if(hasSample) {
        if((data&1)==0) {
          if(delta>0)--delta;
        } else if(delta<63)++delta;
        sample=enabled?(delta<<1)+lsb:0;
        data>>=1;
      }
      --dmaCounter;
      if(dmaCounter<=0) {
        hasSample=false;
        end();
        dmaCounter=8;
      }
    }
    void write(int reg,int value,const int *table) {
      if(reg==0x4010) {
        if((value>>6)==0)mode=0;
        else if(((value>>6)&1)==1)mode=1;
        else if((value>>6)==2)mode=2;
        if(!(value&128))irq=false;
        frequency=table[value&15];
      } else if(reg==0x4011) {
        delta=(value>>1)&63;
        lsb=value&1;
        sample=(delta<<1)+lsb;
      } else if(reg==0x4012) {
        start=(value<<6)|0xc000;
        reg4012=value;
      } else if(reg==0x4013) {
        length=(value<<4)+1;
        reg4013=value;
      } else if(reg==0x4015) {
        irq=false;
        if(((value>>4)&1)==0)remaining=0;
        else if(remaining==0) {
          address=start;
          remaining=length;
          if(!hasSample&&remaining>0) {
            next();
            dmaCounter=8;
            shiftCounter=frequency;
            if(remaining==0&&mode==2)irq=true;
          }
        }
      }
    }
    int status()const {
      return remaining==0||!enabled?0:1;
    }
  };
  struct Fds {
    std::array<uint8_t,64>wave {
    };
    std::array<uint8_t,32>modulation {
    };
    int modIndex=0,curWave=0,envSpeed=0xe8,volSpeed=0,sweepSpeed=0,volGain=0,sweepGain=0;
    bool volUp=false,sweepUp=false,enabled=false,volEnabled=false,envEnabled=false,sweepEnabled=false;
    bool modEnabled=false,modForce=false,writeEnabled=false,io=true;
    int master=0,ticks=0,modCounter=0,freq=0,modFreq=0,accumulator=0,modClock=0,out=0;
    int volPeriod=0,sweepPeriod=0,volTimer=0,sweepTimer=0;
    double rate=44100,low=0,dc=0,lowK=0,dcK=0;
    explicit Fds(double rate=44100):rate(rate) {
      reset();
    }
    void rates() {
      volPeriod=8*(envSpeed+1)*(volSpeed+1);
      sweepPeriod=8*(envSpeed+1)*(sweepSpeed+1);
    }
    void reset() {
      wave.fill(0);
      modulation.fill(0);
      modIndex=curWave=0;
      envSpeed=0xe8;
      volSpeed=sweepSpeed=volGain=sweepGain=0;
      volUp=sweepUp=false;
      master=ticks=modCounter=freq=modFreq=accumulator=modClock=0;
      rates();
      volTimer=volPeriod;
      sweepTimer=sweepPeriod;
      enabled=volEnabled=envEnabled=sweepEnabled=modEnabled=modForce=writeEnabled=false;
      io=true;
      out=0;
      low=dc=0;
      lowK=std::exp(-2*3.141592653589793*2000/rate);
      dcK=std::exp(-2*3.141592653589793*20/rate);
    }
    static int signed7(int n) {
      return ((n&127)^64)-64;
    }
    void write(int address,int v) {
      if(address==0x4023) {
        io=(v&2)!=0;
        return;
      }
      if(!io)return;
      if(address>=0x4040&&address<=0x407f) {
        if(writeEnabled)wave[address&63]=v;
        return;
      }
      if(address<0x4080||address>0x408a)return;
      switch(address&15) {
        case 0:volEnabled=!(v&128);
        volUp=(v&64)!=0;
        volSpeed=v&63;
        if(!volEnabled)volGain=v&63;
        rates();
        volTimer=volPeriod;
        break;
        case 2:freq=(freq&0xf00)|v;
        break;
        case 3:enabled=!(v&128);
        freq=(freq&255)|((v&15)<<8);
        if(!enabled) {
          accumulator=0;
          curWave=wave[0];
        }
        envEnabled=!(v&64);
        if(!envEnabled) {
          volTimer=volPeriod;
          sweepTimer=sweepPeriod;
        }
        break;
        case 4:sweepEnabled=!(v&128);
        sweepUp=(v&64)!=0;
        sweepSpeed=v&63;
        if(!sweepEnabled)sweepGain=v&63;
        rates();
        sweepTimer=sweepPeriod;
        break;
        case 5:modCounter=signed7(v);
        break;
        case 6:modFreq=(modFreq&0xf00)|v;
        break;
        case 7:modEnabled=!(v&128);
        modForce=(v&64)!=0;
        modFreq=(modFreq&255)|((v&15)<<8);
        if(!modEnabled) {
          modClock=0;
          modIndex&=62;
        }
        break;
        case 8:if(!modEnabled) {
          modulation[modIndex>>1]=v&7;
          modIndex=(modIndex+2)&63;
        }
        break;
        case 9:writeEnabled=(v&128)!=0;
        master=v&3;
        break;
        case 10:envSpeed=v;
        rates();
        break;
      }
    }
    void envelope() {
      if(volEnabled) {
        if(volTimer)--volTimer;
        else {
          volTimer=volPeriod;
          if(volUp) {
            if(volGain<32)++volGain;
          } else if(volGain)--volGain;
        }
      }
      if(sweepEnabled) {
        if(sweepTimer)--sweepTimer;
        else {
          sweepTimer=sweepPeriod;
          if(sweepUp) {
            if(sweepGain<32)++sweepGain;
          } else if(sweepGain)--sweepGain;
        }
      }
    }
    void tick() {
      if(envEnabled&&envSpeed) {
        envelope();
        if(!enabled) {
          envelope();
          envelope();
          envelope();
        }
      }
      if(!enabled)ticks=0;
      else if(!(ticks&15)) {
        if(modEnabled) {
          modClock=(modClock+modFreq)&65535;
          if((modClock&0xf000)||modForce) {
            modClock&=4095;
            int entry=modulation[modIndex>>1];
            constexpr int steps[8]= {
              0,1,2,4,0,-4,-2,-1
            };
            modCounter=entry==4?0:signed7(modCounter+steps[entry]);
            modIndex=(modIndex+1)&63;
          }
        }
        int product=modCounter*sweepGain;
        if((product&15)&&!(product&0x800))product+=32;
        int multiplier=((product+1024)>>4)&255;
        accumulator=(accumulator+freq*multiplier)&0xffffff;
        curWave=wave[static_cast<uint32_t>(accumulator)>>18];
      }
      ticks=(ticks+1)&255;
      if(!writeEnabled) {
        int volume=(curWave&63)*std::min(volGain,32);
        if(master) {
          constexpr double gains[4]= {
            1,20.0/30,15.0/30,12.0/30
          };
          volume=static_cast<int>(std::floor(volume*gains[master]));
        }
        out=(volume>>5)&63;
      }
    }
    double sample() {
      double value=static_cast<double>(out)/63*0.3;
      low=lowK*low+(1-lowK)*value;
      dc=dcK*dc+(1-dcK)*low;
      return low-dc;
    }
  };
  struct Apu {
    Square square1 {
      true
    },square2 {
      false
    };
    Triangle triangle;
    Noise noise;
    Dmc dmc;
    bool pal=false,frameIrqEnabled=false,frameIrqActive=false,frameIrqClearPending=false;
    int sampleTimer=0,sampleTimerMax=0,frameCounter=0,frameStep=0,sequence=0,parity=0;
    int accCount=0,smpSquare1=0,smpSquare2=0,smpTriangle=0,smpDmc=0,triValue=0,enableMask=0;
    uint8_t mute=0;
    double prevL=0,prevR=0,accL=0,accR=0,dcValue=0,left=0,right=0;
    bool ready=false;
    std::array<int,512>squareTable {
    };
    std::array<int,3264>tndTable {
    };
    const int *dmcTable=DMC_NTSC,*noiseTable=NOISE_NTSC;
    double rate,clock;
    std::array<uint8_t,65536>*memory;
    Apu(double rate,double clock,std::array<uint8_t,65536>*memory):rate(rate),clock(clock),memory(memory) {
      tables();
      reset();
    }
    void tables() {
      int maxSquare=0,maxTnd=0;
      for(int i=0;i<512;++i) {
        double value=i?95.52/(8128.0/(i/16.0)+100.0):0;
        value*=0.98411;
        value*=50000.0;
        squareTable[i]=static_cast<int>(std::floor(value));
        maxSquare=std::max(maxSquare,squareTable[i]);
      }
      for(int i=0;i<3264;++i) {
        double value=i?163.67/(24329.0/(i/16.0)+100.0):0;
        value*=0.98411;
        value*=50000.0;
        tndTable[i]=static_cast<int>(std::floor(value));
        maxTnd=std::max(maxTnd,tndTable[i]);
      }
      dcValue=(maxSquare+maxTnd)/2.0;
    }
    void reset() {
      square1=Square(true);
      square2=Square(false);
      triangle=Triangle();
      noise=Noise();
      dmc=Dmc();
      dmc.memory=memory;
      pal=clock<1700000;
      dmcTable=pal?DMC_PAL:DMC_NTSC;
      noiseTable=pal?NOISE_PAL:NOISE_NTSC;
      frameIrqEnabled=frameIrqActive=frameIrqClearPending=false;
      sampleTimer=0;
      sampleTimerMax=static_cast<int>(std::floor(1024*clock/rate));
      frameCounter=frameStep=sequence=parity=0;
      accCount=smpSquare1=smpSquare2=smpTriangle=smpDmc=triValue=0;
      prevL=prevR=-dcValue;
      accL=accR=left=right=0;
      ready=false;
      for(int i=0;i<0x14;++i)write(0x4000+i,i==0x10?0x10:0);
      enable(0);
    }
    void enable(int value) {
      enableMask=value&65535;
      square1.setEnabled((value&1)!=0);
      square2.setEnabled((value&2)!=0);
      triangle.setEnabled((value&4)!=0);
      noise.setEnabled((value&8)!=0);
      dmc.enabled=(value&16)!=0;
    }
    void write(int address,int value) {
      if(address>=0x4000&&address<0x4004)square1.write(address,value);
      else if(address>=0x4004&&address<0x4008)square2.write(address,value);
      else if(address>=0x4008&&address<0x400c)triangle.write(address,value);
      else if(address>=0x400c&&address<=0x400f)noise.write(address,value,noiseTable);
      else if(address>=0x4010&&address<=0x4013)dmc.write(address,value,dmcTable);
      else if(address==0x4015) {
        enable(value);
        dmc.write(address,value,dmcTable);
      } else if(address==0x4017) {
        sequence=(value>>7)&1;
        int writeParity=(parity+1)&1;
        frameCounter=-7+writeParity;
        frameStep=0;
        if(value&64) {
          frameIrqEnabled=false;
          frameIrqActive=false;
          frameIrqClearPending=false;
        } else frameIrqEnabled=true;
        if(sequence==1) {
          quarter();
          half();
        }
      }
    }
    void quarter() {
      square1.envClock();
      square2.envClock();
      noise.envClock();
      triangle.linearClock();
    }
    void half() {
      triangle.lengthClock();
      square1.lengthClock();
      square2.lengthClock();
      noise.lengthClock();
      square1.sweepClock();
      square2.sweepClock();
    }
    void fire(int step) {
      if(sequence==0) {
        switch(step) {
          case 0:quarter();
          break;
          case 1:quarter();
          half();
          break;
          case 2:quarter();
          break;
          case 3:frameIrqActive=true;
          frameIrqClearPending=false;
          break;
          case 4:quarter();
          half();
          frameIrqActive=true;
          frameIrqClearPending=false;
          break;
        }
      } else switch(step) {
        case 0:quarter();
        break;
        case 1:quarter();
        half();
        break;
        case 2:quarter();
        break;
        case 4:quarter();
        half();
        break;
      }
    }
    void advance() {
      ++frameCounter;
      constexpr int ntsc4[5]= {
        7457,14913,22371,29828,29829
      },ntsc5[5]= {
        7457,14913,22371,29829,37281
      };
      constexpr int pal4[5]= {
        8313,16627,24939,33252,33253
      },pal5[5]= {
        8313,16627,24939,33253,41565
      };
      const int *steps=sequence==0?(pal?pal4:ntsc4):(pal?pal5:ntsc5);
      int period=sequence==0?(pal?33254:29830):(pal?41566:37282);
      for(;;) {
        if(frameStep<5&&frameCounter>=steps[frameStep]) {
          fire(frameStep);
          ++frameStep;
        } else if(frameStep>=5&&frameCounter>=period) {
          frameStep=0;
          frameCounter-=period;
          if(sequence==0) {
            frameIrqActive=frameIrqEnabled;
            frameIrqClearPending=false;
          }
        } else break;
      }
    }
    void accumulate() {
      if(triangle.condition) {
        triValue=static_cast<int>(std::floor(static_cast<double>(shl(triangle.timer,4))/(triangle.period+1)));
        if(triValue>16)triValue=16;
        if(triangle.counter>=16)triValue=16-triValue;
        triValue+=triangle.sample;
      }
      smpTriangle+=triValue;
      smpDmc+=dmc.sample;
      smpSquare1+=square1.sample;
      smpSquare2+=square2.sample;
      ++accCount;
    }
    void sample() {
      if(accCount>0) {
        smpSquare1=static_cast<int>(std::floor(static_cast<double>(shl(smpSquare1,4))/accCount));
        smpSquare2=static_cast<int>(std::floor(static_cast<double>(shl(smpSquare2,4))/accCount));
        smpTriangle=static_cast<int>(std::floor(static_cast<double>(smpTriangle)/accCount));
        smpDmc=static_cast<int>(std::floor(static_cast<double>(shl(smpDmc,4))/accCount));
        accCount=0;
      } else {
        smpSquare1=shl(square1.sample,4);
        smpSquare2=shl(square2.sample,4);
        smpTriangle=triangle.sample;
        smpDmc=shl(dmc.sample,4);
      }
      int smpNoise=static_cast<int>(std::floor(static_cast<double>(shl(noise.accValue,4))/noise.accCount));
      noise.accValue=smpNoise>>4;
      noise.accCount=1;
      if(mute&1)smpSquare1=0;
      if(mute&2)smpSquare2=0;
      if(mute&4)smpTriangle=0;
      if(mute&8)smpNoise=0;
      if(mute&16)smpDmc=0;
      int sq=shr(smpSquare1*128+smpSquare2*128,8);
      int tnd=shr(3*smpTriangle*128+shl(smpNoise,1)*128+smpDmc*128,8);
      sq=std::min(sq,511);
      tnd=std::min(tnd,3263);
      double value=squareTable[std::max(0,sq)]+tndTable[std::max(0,tnd)]-dcValue;
      double diff=value-prevL;
      prevL+=diff;
      accL+=diff-shr(accL,10);
      left=accL/32768;
      diff=value-prevR;
      prevR+=diff;
      accR+=diff-shr(accR,10);
      right=accR/32768;
      smpSquare1=smpSquare2=smpTriangle=smpDmc=0;
      ready=true;
    }
    void tick() {
      if(frameIrqClearPending) {
        if((parity&1)==0) {
          frameIrqActive=false;
          frameIrqClearPending=false;
        }
      }
      parity=(parity+1)&1;
      // The host calls clockFrameCounter(1), exactly as NesApuAudioEngine.
      // extraCycles remains zero at all supported output rates.
      if(dmc.enabled) {
        dmc.shiftCounter-=8;
        while(dmc.shiftCounter<=0&&dmc.frequency>0) {
          dmc.shiftCounter+=dmc.frequency;
          dmc.clock();
        }
      }
      if(triangle.period>0) {
        --triangle.timer;
        while(triangle.timer<=0) {
          triangle.timer+=triangle.period+1;
          if(triangle.linear>0&&triangle.length>0) {
            triangle.counter=(triangle.counter+1)&31;
            if(triangle.enabled) {
              triangle.sample=triangle.counter>=16?(triangle.counter&15):(15-(triangle.counter&15));
              triangle.sample<<=4;
            }
          }
        }
      }
      --square1.timer;
      if(square1.timer<=0) {
        square1.timer+=(square1.period+1)<<1;
        square1.counter=(square1.counter+1)&7;
        square1.update();
      }
      --square2.timer;
      if(square2.timer<=0) {
        square2.timer+=(square2.period+1)<<1;
        square2.counter=(square2.counter+1)&7;
        square2.update();
      }
      if(noise.timer-1>0) {
        --noise.timer;
        ++noise.accCount;
        noise.accValue+=noise.sample;
      } else {
        if(--noise.timer<=0&&noise.period>0) {
          noise.shift<<=1;
          uint32_t tmp=((noise.shift<<(noise.mode==0?1:6))^noise.shift)&0x8000;
          if(tmp!=0) {
            noise.shift|=1;
            noise.randomBit=0;
            noise.sample=0;
          } else {
            noise.randomBit=1;
            noise.sample=noise.enabled&&noise.length>0?noise.volume:0;
          }
          noise.timer+=noise.period;
        }
        noise.accValue+=noise.sample;
        ++noise.accCount;
      }
      advance();
      accumulate();
      sampleTimer+=1024;
      if(sampleTimer>=sampleTimerMax) {
        sample();
        sampleTimer-=sampleTimerMax;
      }
    }
  };
  struct NativeNes {
    uint32_t rate;
    double baseClock,clock;
    bool fdsEnabled,clockResampler=false;
    uint8_t mute=0,enableMask=0;
    std::array<uint8_t,65536>memory {
    };
    std::array<uint8_t,0x90>registers {
    };
    Fds fds;
    Apu apu;
    double previousL=0,previousR=0,filteredL=0,filteredR=0,dcCoefficient;
    double ratio=1,remainder=0,heldL=0,heldR=0;
    NativeNes(uint32_t rate,double clock,bool fds):rate(rate),baseClock(clock),clock(clock),fdsEnabled(fds),fds(rate),apu(rate,clock,&memory),dcCoefficient(std::exp(-2*3.141592653589793*10/rate)) {
    }
    void reset() {
      memory.fill(0);
      registers.fill(0);
      enableMask=0;
      fds.reset();
      apu.reset();
      apu.mute=mute;
      previousL=previousR=filteredL=filteredR=0;
      remainder=heldL=heldR=0;
    }
    void write(uint16_t address,uint8_t value) {
      if(address>=0x4000&&address<=0x4017) {
        registers[address-0x4000]=value;
        apu.write(address,value);
        if(address==0x4015)enableMask=value&31;
      } else if(fdsEnabled&&(address==0x4023||(address>=0x4040&&address<=0x408a))) {
        registers[address-0x4000]=value;
        fds.write(address,value);
      }
    }
    void enable(int channel,bool on) {
      if(channel>4)return;
      int current=channel==4?enableMask:(enableMask&15)|(apu.dmc.status()<<4);
      write(0x4015,on?(current|(1<<channel)):(current&~(1<<channel)));
    }
    void stop() {
      for(int channel=0;channel<5;++channel)enable(channel,false);
      if(fdsEnabled) {
        write(0x4083,registers[0x83]|128);
        write(0x4080,128);
      }
    }
    void writeEnable(uint8_t value,uint8_t preserve) {
      value=(value&~preserve)|(enableMask&preserve);
      // A repeated $4015 DMC-enable write can refill DMA when its final byte
      // is still shifting. Protected host gates must preserve that last byte
      // exactly, rather than truncate it or restart the sample from the top.
      if(preserve&16) {
        const Dmc before=apu.dmc;
        write(0x4015,value);
        apu.dmc=before;
      } else write(0x4015,value);
    }
    void enableChannel(uint8_t channel,bool on) {
      if(channel<4)writeEnable(on?(enableMask|(1<<channel)):(enableMask&~(1<<channel)),16);
      else if(channel==4)enable(channel,on);
    }
    void stopChannel(uint8_t channel) {
      if(channel<5) {
        enableChannel(channel,false);
        // $4015 alone may leave the final DAC sample latched. A host lease
        // release silences that output while retaining the authored $4011
        // register and decoder level for the next explicit start.
        if(channel==4)apu.dmc.sample=0;
      }
      else if(channel==5&&fdsEnabled) {
        // $4023 disables register writes, not the running oscillator. A host
        // owner release must still halt it without changing the authored IO
        // setting, wave, envelope or other voices.
        const bool io=fds.io;
        fds.io=true;
        write(0x4083,registers[0x83]|128);
        fds.io=io;
      }
    }
    uint32_t activeMask()const {
      // A silent edited patch may become audible without another trigger, so
      // volume/frequency/mute are not lifetime tests. Length exhaustion is.
      // Triangle linear reload can occur on the following frame-counter tick.
      uint32_t result=0;
      if(apu.square1.enabled&&apu.square1.length>0)result|=1;
      if(apu.square2.enabled&&apu.square2.length>0)result|=2;
      if(apu.triangle.enabled&&apu.triangle.length>0)result|=4;
      if(apu.noise.enabled&&apu.noise.length>0)result|=8;
      if(apu.dmc.enabled&&(apu.dmc.remaining>0||apu.dmc.hasSample))result|=16;
      if(fdsEnabled&&fds.enabled)result|=32;
      return result;
    }
    std::array<float,2> source() {
      while(!apu.ready) {
        if(fdsEnabled)fds.tick();
        apu.tick();
      }
      apu.ready=false;
      double extra=fdsEnabled?fds.sample():0;
      if(mute&32)extra=0;
      // NesApuAudioEngine first writes the mix into Float32Array; the wrapper's
      // 10 Hz DC removal then consumes that rounded value with double history.
      float l=static_cast<float>(apu.left+extra),r=static_cast<float>(apu.right+extra);
      filteredL=dcCoefficient*(filteredL+l-previousL);
      filteredR=dcCoefficient*(filteredR+r-previousR);
      previousL=l;
      previousR=r;
      return {
        {
          static_cast<float>(filteredL),static_cast<float>(filteredR)
        }
      };
    }
    std::array<float,2> sample() {
      if(!clockResampler)return source();
      remainder+=ratio;
      int count=static_cast<int>(std::floor(remainder));
      remainder-=count;
      if(count) {
        double l=0,r=0;
        for(int i=0;i<count;++i) {
          auto frame=source();
          l+=frame[0];
          r+=frame[1];
        }
        heldL=l/count;
        heldR=r/count;
      }
      return {
        {
          static_cast<float>(heldL),static_cast<float>(heldR)
        }
      };
    }
    void state(NativeNesState *out) {
      *out= {
      };
      std::copy(registers.begin(),registers.end(),out->registers);
      std::copy(fds.wave.begin(),fds.wave.end(),out->wave);
      std::copy(fds.modulation.begin(),fds.modulation.end(),out->modulation);
      out->periods[0]=apu.square1.period;
      out->periods[1]=apu.square2.period;
      out->periods[2]=apu.triangle.period;
      out->periods[3]=apu.noise.period;
      out->periods[4]=apu.dmc.frequency;
      out->lengths[0]=apu.square1.length;
      out->lengths[1]=apu.square2.length;
      out->lengths[2]=apu.triangle.length;
      out->lengths[3]=apu.noise.length;
      out->volumes[0]=apu.square1.volume;
      out->volumes[1]=apu.square2.volume;
      out->volumes[2]=apu.triangle.linear;
      out->volumes[3]=apu.noise.volume;
      out->dmc_address=apu.dmc.address;
      out->dmc_remaining=apu.dmc.remaining;
      out->dmc_output=apu.dmc.sample;
      out->dmc_frequency=apu.dmc.frequency;
      out->fds_frequency=fds.freq;
      out->fds_mod_frequency=fds.modFreq;
      out->fds_mod_index=fds.modIndex;
      out->fds_mod_clock=fds.modClock;
      out->fds_mod_counter=fds.modCounter;
      out->fds_gain=fds.volGain;
      out->fds_sweep_gain=fds.sweepGain;
      out->fds_master=fds.master;
      out->fds_accumulator=fds.accumulator;
      out->fds_output=fds.out;
      out->enable_mask=enableMask;
      out->mute_mask=mute;
      out->fds_enabled=fdsEnabled;
      out->fds_io=fds.io;
      out->fds_active=fds.enabled;
      out->fds_write_enabled=fds.writeEnabled;
      out->fds_mod_enabled=fds.modEnabled;
      out->frame_irq=apu.frameIrqActive;
      out->dmc_irq=apu.dmc.irq;
      out->clock=clock;
      out->base_clock=baseClock;
    }
  };
}
extern "C" {
  void *native_nes_create(uint32_t rate,double clock,bool fds) {
    if(rate<8000||rate>384000||!std::isfinite(clock)||clock<1600000||clock>1900000)return nullptr;
    try {
      return new NativeNes(rate,clock,fds);
    } catch(...) {
      return nullptr;
    }
  }
  void native_nes_destroy(void *ptr) {
    delete static_cast<NativeNes*>(ptr);
  }
  void native_nes_reset(void *ptr) {
    static_cast<NativeNes*>(ptr)->reset();
  }
  void native_nes_stop(void *ptr) {
    static_cast<NativeNes*>(ptr)->stop();
  }
  void native_nes_stop_channel(void *ptr,uint8_t channel) {
    static_cast<NativeNes*>(ptr)->stopChannel(channel);
  }
  void native_nes_write_enable(void *ptr,uint8_t value,uint8_t preserve_mask) {
    static_cast<NativeNes*>(ptr)->writeEnable(value,preserve_mask&31);
  }
  void native_nes_enable_channel(void *ptr,uint8_t channel,bool enabled) {
    static_cast<NativeNes*>(ptr)->enableChannel(channel,enabled);
  }
  uint32_t native_nes_active_mask(void *ptr) {
    return static_cast<NativeNes*>(ptr)->activeMask();
  }
  uint32_t native_nes_core_size() {
    return sizeof(NativeNes);
  }
  void native_nes_write(void *ptr,uint16_t address,uint8_t value) {
    static_cast<NativeNes*>(ptr)->write(address,value);
  }
  void native_nes_enable(void *ptr,uint8_t channel,bool value) {
    static_cast<NativeNes*>(ptr)->enable(channel,value);
  }
  int native_nes_load(void *ptr,const uint8_t *bytes,uint32_t offset,uint32_t size) {
    if(offset>65536||size>65536-offset||(!bytes&&size))return 0;
    auto&memory=static_cast<NativeNes*>(ptr)->memory;
    if(size)std::memcpy(memory.data()+offset,bytes,size);
    return 1;
  }
  void native_nes_set_mute(void *ptr,uint8_t mask) {
    auto&core=*static_cast<NativeNes*>(ptr);
    core.mute=mask&63;
    core.apu.mute=core.mute;
  }
  int native_nes_set_clock(void *ptr,uint32_t hz) {
    if(hz<100000||hz>100000000)return 0;
    auto&core=*static_cast<NativeNes*>(ptr);
    core.clock=hz;
    core.ratio=hz/core.baseClock;
    core.clockResampler=true;
    return 1;
  }
  void native_nes_sample(void *ptr,float *left,float *right) {
    auto frame=static_cast<NativeNes*>(ptr)->sample();
    *left=frame[0];
    *right=frame[1];
  }
  void native_nes_get_state(void *ptr,NativeNesState*out) {
    static_cast<NativeNes*>(ptr)->state(out);
  }
  uint8_t native_nes_read_memory(void *ptr,uint16_t address) {
    return static_cast<NativeNes*>(ptr)->memory[address];
  }
}
