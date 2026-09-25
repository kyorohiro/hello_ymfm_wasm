/* Bounded tree graph. Draft construction is atomic: invalid commits leave active
 * routing intact. Each stateful instance may occur once. No audio-thread allocation. */
#include <string.h>
#define N 32
#define S 8
/* 0 chain/branch, 1 parallel sum, 2 gain, 3 EQ, 4 gate, 5 compressor, 6 reverb */
typedef struct { int type,slot,count,children[N]; } Node;
static Node draft[N], active[N];
static int count, active_count, root=-1;
#define DECLARE(name) int name##_select(int); void name##_tick(float*,float*);
DECLARE(gain) DECLARE(eq) DECLARE(gate) DECLARE(compressor) DECLARE(reverb)
void gain_only_reset(void); void gain_set(float,int);
void eq_reset(double); void eq_clear(void); void eq_set(int,double);
void gate_reset(double); void gate_clear(void);
void compressor_reset(double); void compressor_clear(void);
void reverb_reset(double); void reverb_clear(void);
float *gain_input(void); float *gain_output(void); int gain_capacity(void);
void graph_begin(void) { count=0; }
int graph_add(int type,int slot) {
    if(count>=N || type<0 || type>6 || slot<0 || slot>=S) return -1;
    draft[count]=(Node){.type=type,.slot=slot}; return count++;
}
int graph_append(int parent,int child) {
    if(parent<0 || parent>=count || child<0 || child>=parent || draft[parent].type>1 || draft[parent].count>=N) return 0;
    draft[parent].children[draft[parent].count++]=child; return 1;
}
static int visit(int id,int *seen,int used[7][S]) {
    if(seen[id]++) return 0;
    Node *n=&draft[id];
    if(n->type>1 && used[n->type][n->slot]++) return 0;
    if(n->type==1 && n->count==0) return 0;
    for(int i=0;i<n->count;i++) if(!visit(n->children[i],seen,used)) return 0;
    return 1;
}
int graph_commit(int id) {
    int seen[N]={0},used[7][S]={{0}};
    if(id<0 || id>=count || !visit(id,seen,used)) return 0;
    for(int i=0;i<count;i++) if(!seen[i]) return 0;
    memcpy(active,draft,sizeof draft); active_count=count; root=id; return 1;
}
void graph_clear(void) {
    for(int i=0;i<S;i++) {
        eq_select(i); eq_clear(); gate_select(i); gate_clear();
        compressor_select(i); compressor_clear(); reverb_select(i); reverb_clear();
    }
    eq_select(0); gate_select(0); compressor_select(0); reverb_select(0);
}
void graph_reset(double rate) {
    root=-1; active_count=0; count=0;
    for(int i=0;i<S;i++) {
        gain_select(i); gain_only_reset(); eq_select(i); eq_reset(rate);
        gate_select(i); gate_reset(rate); compressor_select(i); compressor_reset(rate);
        reverb_select(i); reverb_reset(rate);
    }
    gain_select(0); eq_select(0); gate_select(0); compressor_select(0); reverb_select(0);
}
static void tick(int id,float *l,float *r) {
    Node *n=&active[id];
    switch(n->type) {
    case 0: for(int i=0;i<n->count;i++) tick(n->children[i],l,r); break;
    case 1: {
        float suml=0,sumr=0;
        for(int i=0;i<n->count;i++) { float a=*l,b=*r; tick(n->children[i],&a,&b); suml+=a; sumr+=b; }
        *l=suml; *r=sumr; break;
    }
    case 2: gain_select(n->slot); gain_tick(l,r); break;
    case 3: eq_select(n->slot); eq_tick(l,r); break;
    case 4: gate_select(n->slot); gate_tick(l,r); break;
    case 5: compressor_select(n->slot); compressor_tick(l,r); break;
    case 6: reverb_select(n->slot); reverb_tick(l,r); break;
    }
}
void graph_process(int frames) {
    int capacity=gain_capacity(); if(frames<0 || frames>capacity) return;
    float *in=gain_input(), *out=gain_output();
    for(int i=0;i<frames;i++) {
        float l=in[i],r=in[capacity+i]; if(root>=0) tick(root,&l,&r);
        out[i]=l; out[capacity+i]=r;
    }
    gain_select(0); eq_select(0); gate_select(0); compressor_select(0); reverb_select(0);
}
