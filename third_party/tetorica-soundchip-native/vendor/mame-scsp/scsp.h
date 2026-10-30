// license:BSD-3-Clause
// copyright-holders:ElSemi, R. Belmont
// Standalone adaptation Copyright (c) 2026 kyorohiro.
#pragma once
#include "standalone_support.h"
#include "scspdsp.h"
#define SCSP_FM_DELAY 0
class scsp_device {
public:
    scsp_device() { reset(true); }
    void reset(bool clear_ram);
    void render(float *left,float *right,u32 frames);
    void write(u32 offset,u16 data,u16 mask=0xffff);
    u16 read(u32 offset) { return r16(offset*2); }
    scsp_memory memory;
private:
	enum SCSP_STATE { SCSP_ATTACK, SCSP_DECAY1, SCSP_DECAY2, SCSP_RELEASE };

	struct SCSP_EG_t
	{
		int volume; //
		SCSP_STATE state;
		int step;
		//step vals
		int AR;     //Attack
		int D1R;    //Decay1
		int D2R;    //Decay2
		int RR;     //Release

		int DL;     //Decay level
		u8 EGHOLD;
		u8 LPLINK;
	};

	struct SCSP_LFO_t
	{
		u16 phase;
		u32 phase_step;
		int *table;
		int *scale;
	};

	struct SCSP_SLOT
	{
		union
		{
			u16 data[0x10];  //only 0x1a bytes used
			u8 datab[0x20];
		} udata;

		u8 Backwards;    //the wave is playing backwards
		u8 active;   //this slot is currently playing
		u32 cur_addr;    //current play address (24.8)
		u32 nxt_addr;    //next play address
		u32 step;        //pitch step (24.8)
		SCSP_EG_t EG;            //Envelope
		SCSP_LFO_t PLFO;     //Phase LFO
		SCSP_LFO_t ALFO;     //Amplitude LFO
		int slot;
		s16 Prev;  //Previous sample (for interpolation)
	};


    union { u16 data[0x30/2]; u8 datab[0x30]; } m_udata{};
    SCSP_SLOT m_Slots[32]{};
    s16 m_RINGBUF[128]{};
    u8 m_BUFPTR=0, m_latched_MSLC=0;
    u16 m_latched_MSLC_data=0;
    s32 m_EG_TABLE[0x400]{};
    int m_LPANTABLE[0x10000]{},m_RPANTABLE[0x10000]{};
    int m_ARTABLE[64]{},m_DRTABLE[64]{};
    SCSPDSP m_DSP{};
    s16 *m_RBUFDST=nullptr;
    int m_PLFO_TRI[256]{},m_PLFO_SQR[256]{},m_PLFO_SAW[256]{},m_PLFO_NOI[256]{};
    int m_ALFO_TRI[256]{},m_ALFO_SQR[256]{},m_ALFO_SAW[256]{},m_ALFO_NOI[256]{};
    int m_PSCALES[8][256]{},m_ASCALES[8][256]{};
    u32 random_state=0x6d2b79f5;
    u32 random() { u32 x=random_state; x^=x<<13; x^=x>>17; x^=x<<5; return random_state=x; }
    u8 read_byte(u32 at) const { return memory.read_byte(at); }
    u16 read_word(u32 at) const { return memory.read_word(at); }
    void update_monitor();
    int Get_AR(int base,int R); int Get_DR(int base,int R);
    void Compute_EG(SCSP_SLOT *slot); int EG_Update(SCSP_SLOT *slot);
    u32 Step(SCSP_SLOT *slot); void Compute_LFO(SCSP_SLOT *slot);
    void StartSlot(SCSP_SLOT *slot); void StopSlot(SCSP_SLOT *slot,int keyoff);
    void init(); void UpdateSlotReg(int s,int r); void UpdateReg(int reg);
    void UpdateSlotRegR(int slot,int reg); void UpdateRegR(int reg);
    void w16(u32 addr,u16 val); u16 r16(u32 addr);
    s32 UpdateSlot(SCSP_SLOT *slot); void DoMasterSamples(sound_stream &stream);
    void LFO_Init(); s32 PLFO_Step(SCSP_LFO_t *LFO); s32 ALFO_Step(SCSP_LFO_t *LFO);
    void LFO_ComputeStep(SCSP_LFO_t *LFO,u32 LFOF,u32 LFOWS,u32 LFOS,int ALFO);
};
