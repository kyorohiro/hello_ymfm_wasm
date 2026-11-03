/* Stereo PCM gain proof of concept. No allocation on the audio thread. */
#include <math.h>
#include "reverb.h"
#include "compressor.h"
#include "noise_gate.h"
#define CAPACITY 2048
static float input[CAPACITY * 2];
static float output[CAPACITY * 2];
typedef struct { float current,target,step; int remaining; } State;
static State instances[8];
static State *state = &instances[0];
int gain_select(int slot) { if(slot<0 || slot>=8) return 0; state=&instances[slot]; return 1; }
float *gain_input(void) { return input; }
float *gain_output(void) { return output; }
int gain_capacity(void) { return CAPACITY; }
void eq_reset(double sample_rate);
void eq_tick(float *,float *);
void gain_reset(void) { eq_reset(48000); reverb_reset(48000); compressor_reset(48000); gate_reset(48000); state->current = state->target = 1.0f; state->step = 0; state->remaining = 0; }
void gain_set(float value, int ramp_frames) {
    if (!(value >= 0.0f && value <= 10.0f)) return;
    state->target = value;
    state->remaining = ramp_frames > 0 ? ramp_frames : 0;
    if (state->remaining) state->step = (state->target - state->current) / state->remaining;
    else state->current = state->target;
}
void gain_process(int frames) {
    if (frames < 0 || frames > CAPACITY) return;
    for (int i = 0; i < frames; ++i) {
        if (state->remaining > 0) { state->current += state->step; if (--state->remaining == 0) state->current = state->target; }
        output[i] = input[i] * state->current;
        output[CAPACITY+i] = input[CAPACITY+i] * state->current;
        eq_tick(&output[i], &output[CAPACITY+i]);
        gate_tick(&output[i], &output[CAPACITY+i]);
        compressor_tick(&output[i], &output[CAPACITY+i]);
        reverb_tick(&output[i], &output[CAPACITY+i]);
    }
}

void gain_tick(float *left,float *right) {
    if(state->remaining>0) { state->current+=state->step; if(--state->remaining==0) state->current=state->target; }
    *left *= state->current; *right *= state->current;
}
void gain_only_reset(void) { state->current=state->target=1; state->step=0; state->remaining=0; }
