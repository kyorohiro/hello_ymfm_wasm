// license:BSD-3-Clause
// copyright-holders:Barry Rodewald
// Standalone adaptation: see README.md.
#include "okim6258.h"
#include <cmath>
static const int dividers[4] = { 1024, 768, 512, 512 };

/* step size index shift table */
static const int index_shift[8] = { -1, -1, -1, -1, 2, 4, 6, 8 };

/* lookup table for the precomputed difference */
static int diff_lookup[49*16];

/* tables computed? */
static int tables_computed = 0;



static void compute_tables()
{
	/* nibble to bit map */
	static const int nbl2bit[16][4] =
	{
		{ 1, 0, 0, 0}, { 1, 0, 0, 1}, { 1, 0, 1, 0}, { 1, 0, 1, 1},
		{ 1, 1, 0, 0}, { 1, 1, 0, 1}, { 1, 1, 1, 0}, { 1, 1, 1, 1},
		{-1, 0, 0, 0}, {-1, 0, 0, 1}, {-1, 0, 1, 0}, {-1, 0, 1, 1},
		{-1, 1, 0, 0}, {-1, 1, 0, 1}, {-1, 1, 1, 0}, {-1, 1, 1, 1}
	};

	int step, nib;

	/* loop over all possible steps */
	for (step = 0; step <= 48; step++)
	{
		/* compute the step value */
		int stepval = floor(16.0 * pow(11.0 / 10.0, (double)step));

		/* loop over all nibbles and compute the difference */
		for (nib = 0; nib < 16; nib++)
		{
			diff_lookup[step*16 + nib] = nbl2bit[nib][0] *
				(stepval   * nbl2bit[nib][1] +
					stepval/2 * nbl2bit[nib][2] +
					stepval/4 * nbl2bit[nib][3] +
					stepval/8);
		}
	}

	tables_computed = 1;
}


int16_t Oki6258::clock_adpcm(uint8_t nibble)
{
	int32_t max = (1 << (m_output_bits - 1)) - 1;
	int32_t min = -(1 << (m_output_bits - 1));

	m_signal += diff_lookup[m_step * 16 + (nibble & 15)];

	/* clamp to the maximum */
	if (m_signal > max)
		m_signal = max;
	else if (m_signal < min)
		m_signal = min;

	/* adjust the step size and clamp */
	m_step += index_shift[nibble & 7];
	if (m_step > 48)
		m_step = 48;
	else if (m_step < 0)
		m_step = 0;

	/* return the signal scaled up to 32767 */
	return m_signal * 16;
}



Oki6258::Oki6258(uint32_t clock, uint8_t flags, uint32_t rate):initial_clock(clock),initial_flags(flags),rate(rate) { compute_tables();reset(); }
void Oki6258::reset() {
 clock=clock_buffer=initial_clock;divider=dividers[initial_flags&3];m_output_bits=(initial_flags&8)?12:10;
 m_signal=-2;m_step=0;data=shift=pan=0;playing=false;phase=0;last=0;
 fifoHead=fifoTail=fifoCount=0;nibblesLeft=0;
}
void Oki6258::write(uint8_t reg,uint8_t value) {
 if(reg==0) {
  if(value&1){playing=false;last=0;return;}
  if(value&2){if(!playing){m_signal=-2;m_step=0;shift=0;fifoHead=fifoTail=fifoCount=0;nibblesLeft=0;}playing=true;}
  else {playing=false;last=0;}
 } else if(reg==1){
  // Queue the byte; generate() advances to it only once the previous byte's
  // two nibbles are both clocked out (see kFifoSize comment in the header).
  if(fifoCount<kFifoSize){fifo[fifoTail]=value;fifoTail=(fifoTail+1)%kFifoSize;fifoCount++;}
 }
 else if(reg==2)pan=value&3;
 else if(reg>=8 && reg<=11){unsigned n=(reg-8)*8;clock_buffer=(clock_buffer&~(uint32_t(255)<<n))|(uint32_t(value)<<n);if(reg==11)clock=clock_buffer&0x3fffffff;}
 else if(reg==12)divider=dividers[value&3];
}
void Oki6258::generate(float *left,float *right,uint32_t frames) {
 for(uint32_t i=0;i<frames;i++) {
  // Fractional VCLK phase survives buffer boundaries and clock/divider changes.
  phase+=double(clock)/divider/rate;
  while(phase>=1){
   phase-=1;
   if(playing){
    if(nibblesLeft==0 && fifoCount>0){data=fifo[fifoHead];fifoHead=(fifoHead+1)%kFifoSize;fifoCount--;shift=0;nibblesLeft=2;}
    if(nibblesLeft>0){last=clock_adpcm((data>>shift)&15)/32768.0f;shift^=4;nibblesLeft--;}
   } else last=0;
  }
  left[i]=(pan&2)?0:last;right[i]=(pan&1)?0:last;
 }
}
