#ifndef NATIVE_NOISE_GATE_H
#define NATIVE_NOISE_GATE_H
void gate_reset(double sample_rate);
void gate_clear(void);
void gate_set(float threshold_db, float hysteresis_db, float attack_ms,
              float hold_ms, float release_ms, int bypass);
void gate_tick(float *left, float *right);
#endif
