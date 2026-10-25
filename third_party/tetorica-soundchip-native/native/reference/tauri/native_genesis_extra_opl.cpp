// Independent additional OPL/OPL2/OPL3/Y8950; no machine or PCM memory bank.
#include "native_genesis_extra_opl.h"
#include "ymfm_opl.h"
#include "native_genesis_y8950_memory.h"
#include "ymfm_fm.ipp"
#include <algorithm>
#include <array>
#include <cstring>
#include <vector>
// The Native OPL provider explicitly supplies complete template definitions.
extern template class ymfm::fm_engine_base<ymfm::opl_registers>;
extern template class ymfm::fm_engine_base<ymfm::opl2_registers>;
extern template class ymfm::fm_engine_base<ymfm::opl3_registers>;
extern template class ymfm::fm_channel<ymfm::opl_registers>;
extern template class ymfm::fm_channel<ymfm::opl2_registers>;
extern template class ymfm::fm_channel<ymfm::opl3_registers>;
extern template class ymfm::fm_operator<ymfm::opl_registers>;
extern template class ymfm::fm_operator<ymfm::opl2_registers>;
extern template class ymfm::fm_operator<ymfm::opl3_registers>;
namespace {
constexpr uint8_t SLOTS[9] = {0,1,2,8,9,10,16,17,18}, PHYSICAL[5] = {6,7,8,8,7}, PAIRS[6] = {0,1,2,9,10,11};
float normalize(int32_t value) { return float(std::max(-32768, std::min(32767,value))) / 32768.0f; }
template<class T> struct Cached : T {
    using Output = typename T::output_data;
    static constexpr uint32_t CHANNELS = T::fm_engine::CHANNELS;
    static constexpr bool OPL3 = T::OUTPUTS == 4;
    std::array<Output, CHANNELS> held{};
    std::array<uint8_t, CHANNELS> routes{};
    std::array<int32_t, 5> drums{};
    Output adpcm{}, combined{};
    explicit Cached(ymfm_wasm_interface &intf) : T(intf) {}
    // The pinned engine lacks a const accessor; these register getters do not
    // perform bus reads, update flags, invalidate caches or advance synthesis.
    const auto &regs()const{return const_cast<Cached*>(this)->m_fm.regs();}
    uint8_t pair_mask() const { return regs().fourop_enable(); }
    uint8_t primary(uint8_t ch) const { for(uint8_t i=0;i<6;++i)if((pair_mask()&(1u<<i))&&ch==PAIRS[i]+3)return PAIRS[i];return ch; }
    void internal_write(uint16_t reg,uint8_t value) { this->m_fm.write(reg,value); }
    uint8_t internal_read(uint16_t reg) const { return regs().read(reg); }
    void remix() {
        combined=adpcm;
        for(const auto &value:held)for(uint32_t bus=0;bus<T::OUTPUTS;++bus)combined.data[bus]+=value.data[bus];
        if(OPL3)combined.clamp16();else combined.roundtrip_fp();
    }
    void stereo(float &left,float &right) const {
        left=normalize(combined.data[0]+(OPL3?combined.data[2%T::OUTPUTS]:0));
        right=normalize(combined.data[OPL3?1%T::OUTPUTS:0]+(OPL3?combined.data[3%T::OUTPUTS]:0));
    }
    void clear_history() { for(auto &value:held)value.clear();routes.fill(0);drums.fill(0);adpcm.clear();combined.clear(); }
    void silence(uint8_t ch) { held[ch].clear();remix(); }
    void route(uint8_t ch,int32_t value) {
        auto &output=held[ch];output.clear();for(uint32_t bus=0;bus<T::OUTPUTS;++bus)if(routes[ch]&(1u<<bus))output.data[bus]+=value;
    }
    void silence_drum(uint8_t index) {
        drums[index]=0;
        if(index==0)held[6].clear();
        else {const uint8_t ch=PHYSICAL[index];const int32_t raw=ch==7?drums[1]+drums[4]:drums[2]+drums[3];route(ch,std::max(-32768,std::min(32767,raw))*2);}
        remix();
    }
    void extras() { adpcm.clear(); }
    void clear_csm() { if(!OPL3){for(uint8_t op=0;op<18;++op)this->m_fm.debug_operator(op)->keyonoff(0,ymfm::KEYON_CSM);this->m_fm.invalidate_caches();} }
    void generate_cached(uint32_t muted,uint8_t cancelled) {
        this->m_fm.clock(T::fm_engine::ALL_CHANNELS);extras();
        for(uint8_t i=0;i<6;++i)if(pair_mask()&(1u<<i)){const uint32_t bits=(1u<<PAIRS[i])|(1u<<(PAIRS[i]+3));if(muted&bits)muted|=bits;}
        for(uint8_t ch=0;ch<CHANNELS;++ch){
            const uint16_t offset=ch<9?ch:ch+0x100-9;const auto &r=this->m_fm.regs();
            routes[ch]=r.ch_output_0(offset)|(r.ch_output_1(offset)<<1)|(r.ch_output_2(offset)<<2)|(r.ch_output_3(offset)<<3);
            this->m_fm.output(held[ch].clear(),OPL3?0:1,32767,1u<<ch);if(muted&(1u<<ch))held[ch].clear();
        }
        if(this->m_fm.regs().rhythm_enable()){
            const auto *hh=this->m_fm.debug_channel(7)->debug_operator(0),*sd=this->m_fm.debug_channel(7)->debug_operator(1),*tom=this->m_fm.debug_channel(8)->debug_operator(0),*cym=this->m_fm.debug_channel(8)->debug_operator(1);
            const uint32_t a=hh->phase(),b=cym->phase(),select=((a>>2^a>>7)&1)|((a>>3)&1)|((b>>5^b>>3)&1),noise=this->m_fm.regs().noise_state()&1,am=this->m_fm.regs().lfo_am_offset(7),shift=OPL3?0:1;
            drums[1]=sd->compute_volume((0x100<<((a>>8)&1))^(noise<<8),am)>>shift;drums[4]=hh->compute_volume((select<<9)|(0xd0>>(2*(noise^select))),am)>>shift;
            drums[2]=tom->compute_volume(tom->phase(),am)>>shift;drums[3]=cym->compute_volume(0x100|(select<<9),am)>>shift;
            if(muted&(1u<<7))drums[1]=drums[4]=0;if(muted&(1u<<8))drums[2]=drums[3]=0;
            for(uint8_t index=0;index<5;++index)if(cancelled&(1u<<index))silence_drum(index);
        }else drums.fill(0);
        remix();
    }
};
template<> void Cached<ymfm::y8950>::extras() { this->m_adpcm_b.clock(); this->m_adpcm_b.output(adpcm.clear(),3); }
struct Base {
    virtual ~Base()=default;
    virtual void reset()=0; virtual void stop(bool)=0; virtual void all_off()=0; virtual void write(uint16_t,uint8_t)=0;
    virtual void off(uint8_t,bool)=0; virtual void preview_off(uint8_t)=0; virtual void audition(uint8_t)=0;
    virtual void source_preview_off(uint8_t)=0;virtual void source_audition(uint8_t)=0;
    virtual uint64_t memory_upload_revision()const=0; virtual uint64_t memory_revision()const=0; virtual void memory_page(uint32_t,uint8_t*)=0; virtual void memory_length(uint32_t)=0;
    virtual void cancel_csm()=0; virtual void cancel_adpcm()=0; virtual void sample(float*,float*)=0;
    virtual bool csm() const=0; virtual uint8_t pair_mask() const=0;
    virtual uint8_t effective_register(uint16_t)const=0;virtual void effective_registers(uint8_t*)const=0;
    virtual int set_clock(uint32_t)=0; virtual uint8_t read(uint8_t)=0; virtual uint8_t status()=0; virtual uint8_t irq()const=0; virtual void state(NativeExtraOplState*)=0;
};
template<class T> struct Native final : Base {
    static constexpr uint8_t CHANNELS=T::fm_engine::CHANNELS;
    NativeY8950Memory intf;
    Cached<T> chip;
    const uint32_t rate;
    const uint8_t kind;
    uint32_t clock,forced=(1u<<CHANNELS)-1,pending=0,source_pending=0;
    uint8_t cancelled_drums=0,timer_loads=0;
    uint64_t remainder=0;
    double held_left=0,held_right=0;
    bool silent=true;
    std::array<uint8_t,512> registers{};
    // Applied authoring values after NEW bus folding. Internal presentation
    // mutes stay out of this Inspector plane; public raw shadow stays separate.
    std::array<uint8_t,Cached<T>::OPL3?512:0> effective{};
    std::vector<uint8_t> initial;
    Native(uint32_t sr,uint8_t type):chip(intf),rate(sr),kind(type),clock(type==2?14318180:3579545){chip.reset();initial.reserve(4096);ymfm::ymfm_saved_state state(initial,true);chip.save_restore(state);}
    uint16_t address(uint8_t ch,uint8_t base) const {return (ch>=9?0x100:0)+base+ch%9;}
    uint16_t bus_register(uint16_t reg)const{return kind==2&&!(effective[0x105]&1)&&reg>=256&&reg!=0x105?reg&255:reg;}
    void raw(uint16_t reg,uint8_t value,bool observe=false){if(observe&&kind==2)effective[bus_register(reg)]=value;chip.write((reg>>8)*2,uint8_t(reg));chip.write((reg>>8)*2+1,value);}
    bool csm()const override{return kind!=2&&(registers[8]&128)&&(timer_loads&1);}
    uint8_t pair_mask()const override{return chip.pair_mask();}
    uint8_t effective_register(uint16_t reg)const override{return reg<(kind==2?512:256)?chip.internal_read(reg):0;}
    void effective_registers(uint8_t*out)const override{std::memcpy(out,kind==2?effective.data():registers.data(),512);}
    uint8_t public_pair(uint8_t ch)const {if(kind==2)for(uint8_t i=0;i<6;++i)if(ch==PAIRS[i]&&(registers[0x104]&(1u<<i)))return ch+3;return ch;}
    bool rhythm()const{return registers[0xbd]&32;}
    uint8_t runtime_rhythm()const{return kind==2?chip.internal_read(0xbd):registers[0xbd];}
    bool drum_active(uint8_t ch)const {if(!rhythm())return false;for(uint8_t i=0;i<5;++i)if(PHYSICAL[i]==ch&&(registers[0xbd]&(16>>i)))return true;return false;}
    void restore_one(uint8_t ch){if(forced&(1u<<ch)){forced&=~(1u<<ch);for(uint8_t slot:{SLOTS[ch%9],uint8_t(SLOTS[ch%9]+3)}){const uint16_t reg=(ch>=9?0x100:0)+0x40+slot;raw(reg,registers[reg],true);}}}
    void restore(uint8_t ch){restore_one(ch);restore_one(public_pair(ch));}
    int operator_channel(uint16_t reg)const {const uint8_t slot=reg&31;for(uint8_t ch=0;ch<9;++ch)if(slot==SLOTS[ch]||slot==SLOTS[ch]+3)return (reg>>8)*9+ch;return -1;}
    uint64_t memory_upload_revision()const override{return kind==3?intf.memory_upload_revision:0;}
    uint64_t memory_revision()const override{return kind==3?intf.memory_revision:0;}
    void memory_page(uint32_t i,uint8_t*p)override{if(kind==3)intf.memory_page(i,p);}
    void memory_length(uint32_t n)override{if(kind==3)intf.memory_length(n);}
    void write(uint16_t reg,uint8_t value)override{
        if(reg>=(kind==2?512:256))return;const uint8_t old=registers[reg],low=uint8_t(reg);registers[reg]=value;
        if(kind==2)effective[bus_register(reg)]=value;
        if(reg==4&&!(value&128))timer_loads=value&3;
        if(csm())cancelled_drums=0;
        if(kind==3&&reg==7&&(value&128)&&!(value&1))silent=false;
        if(low>=0xb0&&low<=0xb8){const uint8_t ch=(reg>>8)*9+low-0xb0;pending&=~(1u<<ch);source_pending&=~(1u<<ch);if(value&32){restore(ch);silent=false;}}
        if(low==0xbd){for(uint8_t i=0;i<5;++i)if((old^value)&(16>>i)){pending&=~(1u<<(18+i));source_pending&=~(1u<<(18+i));}if(value&31){for(uint8_t ch=6;ch<9;++ch)restore(ch);silent=false;}for(uint8_t i=0;i<5;++i)if(value&(16>>i))cancelled_drums&=~(1u<<i);}
        const int ch=low>=0x40&&low<=0x55?operator_channel(reg):-1;raw(reg,ch>=0&&(forced&(1u<<ch))?uint8_t((value&192)|63):value);
    }
    void update_hold(){if(chip.sample_rate(clock)<rate){float l,r;chip.stereo(l,r);held_left=l;held_right=r;}}
    void off(uint8_t voice,bool normal_only)override{if(kind==3&&voice==23){write(7,(registers[7]&16)|1);return;}
        if(voice<CHANNELS){
            const uint16_t reg=address(voice,0xb0);pending&=~(1u<<voice);source_pending&=~(1u<<voice);registers[reg]&=~32;
            // Runtime cancellation addresses the physical core directly. NEW=0
            // bus aliases cannot redirect an old upper voice's release below.
            if(kind==2){effective[reg]&=~32;chip.internal_write(reg,chip.internal_read(reg)&~32);}else raw(reg,registers[reg]);
            if((normal_only&&csm())||((runtime_rhythm()&32)&&voice>=6&&voice<=8)||chip.primary(voice)!=voice)return;
            forced|=1u<<voice;
            for(uint8_t slot:{SLOTS[voice%9],uint8_t(SLOTS[voice%9]+3)}){const uint16_t tl=(voice>=9?0x100:0)+0x40+slot;if(kind==2)chip.internal_write(tl,(chip.internal_read(tl)&192)|63);else raw(tl,(registers[tl]&192)|63);}
            chip.silence(voice);update_hold();
        }else if(voice>=18&&voice<23){
            const uint8_t index=voice-18,bit=16>>index,actual=runtime_rhythm();pending&=~(1u<<voice);source_pending&=~(1u<<voice);registers[0xbd]&=~bit;
            if(kind==2){effective[0xbd]&=~bit;chip.internal_write(0xbd,actual&~bit);}else raw(0xbd,registers[0xbd]);
            if(!(actual&32)||csm())return;cancelled_drums|=1u<<index;chip.silence_drum(index);update_hold();
        }
    }
    void preview_one(uint8_t ch){const uint16_t reg=address(ch,0xb0);pending&=~(1u<<ch);source_pending&=~(1u<<ch);registers[reg]&=~32;raw(reg,registers[reg],true);forced|=1u<<ch;for(uint8_t slot:{SLOTS[ch%9],uint8_t(SLOTS[ch%9]+3)}){const uint16_t tl=(ch>=9?0x100:0)+0x40+slot;raw(tl,(registers[tl]&192)|63);}}
    void preview_off(uint8_t voice)override {if(kind==3&&voice==23){write(7,(registers[7]&16)|1);return;}if(voice<CHANNELS){preview_one(voice);const uint8_t pair=public_pair(voice);if(pair!=voice)preview_one(pair);}else if(voice>=18&&voice<23){pending&=~(1u<<voice);source_pending&=~(1u<<voice);write(0xbd,registers[0xbd]&~(16>>(voice-18)));}}
    void audition(uint8_t voice)override{if(kind==3&&voice==23){const uint8_t repeat=registers[7]&16;write(7,repeat|1);write(7,0xa0|repeat);return;}if(voice<CHANNELS||(voice>=18&&voice<23&&rhythm())){preview_off(voice);pending|=1u<<voice;}}
    void source_preview_off(uint8_t voice)override{
        if(kind!=2){preview_off(voice);return;}
        const auto cached=chip.held;const auto routes=chip.routes;const auto drums=chip.drums;const auto combined=chip.combined;
        const double l=held_left,r=held_right;const uint8_t cancelled=cancelled_drums;
        off(voice,true);chip.held=cached;chip.routes=routes;chip.drums=drums;chip.combined=combined;held_left=l;held_right=r;cancelled_drums=cancelled;
    }
    void source_audition(uint8_t voice)override{
        if(kind!=2){audition(voice);return;}
        if(voice<CHANNELS||(voice>=18&&voice<23&&(runtime_rhythm()&32))){source_preview_off(voice);pending|=1u<<voice;source_pending|=1u<<voice;}
    }
    void source_restore(uint8_t ch){
        forced&=~(1u<<ch);
        for(uint8_t slot:{SLOTS[ch%9],uint8_t(SLOTS[ch%9]+3)}){const uint16_t reg=(ch>=9?256:0)+0x40+slot;chip.internal_write(reg,effective[reg]);}
    }
    void source_start(uint8_t voice){
        if(voice<CHANNELS){
            source_restore(voice);
            for(uint8_t i=0;i<6;++i)if(PAIRS[i]==voice&&(pair_mask()&(1u<<i)))source_restore(voice+3);
            const uint16_t reg=address(voice,0xb0);registers[reg]|=32;effective[reg]|=32;chip.internal_write(reg,chip.internal_read(reg)|32);silent=false;
        }else if(voice>=18&&voice<23&&(runtime_rhythm()&32)){
            const uint8_t i=voice-18,bit=16>>i;source_restore(PHYSICAL[i]);cancelled_drums&=~(1u<<i);registers[0xbd]|=bit;effective[0xbd]|=bit;chip.internal_write(0xbd,chip.internal_read(0xbd)|bit);silent=false;
        }
    }
    void cancel_csm()override{if(kind==2)return;write(8,registers[8]&~128);write(4,(registers[4]&~0x83)|(timer_loads&2));chip.clear_csm();for(uint8_t ch=0;ch<CHANNELS;++ch)if(!(registers[address(ch,0xb0)]&32)&&!drum_active(ch)&&!(pending&(1u<<ch)))off(ch,false);}
    void cancel_adpcm()override{if(kind==3){write(7,1);chip.adpcm.clear();chip.remix();update_hold();}}
    void all_off()override{if(kind==3)cancel_adpcm();pending=source_pending=0;for(uint8_t ch=0;ch<CHANNELS;++ch)write(address(ch,0xb0),registers[address(ch,0xb0)]&~32);write(0xbd,registers[0xbd]&224);}
    void stop(bool strong)override{pending=source_pending=0;for(uint8_t ch=0;ch<CHANNELS;++ch)preview_off(ch);write(0xbd,registers[0xbd]&224);silent=true;held_left=held_right=0;if(strong){if(kind==2)for(uint8_t ch=0;ch<CHANNELS;++ch)off(ch,false);cancel_csm();}cancel_adpcm();}
    void reset()override{ymfm::ymfm_saved_state state(initial,false);chip.save_restore(state);intf.irq_asserted=false;intf.timer_remaining[0]=intf.timer_remaining[1]=-1;registers.fill(0);effective.fill(0);forced=(1u<<CHANNELS)-1;pending=source_pending=cancelled_drums=timer_loads=0;remainder=0;held_left=held_right=0;silent=true;chip.clear_history();}
    void sample(float*l,float*r)override{
        remainder+=chip.sample_rate(clock);const uint32_t count=uint32_t(remainder/rate);remainder-=uint64_t(count)*rate;
        if(count){double a=0,b=0;for(uint32_t i=0;i<count;++i){chip.generate_cached(forced,cancelled_drums);intf.advance(kind==2?288:72);float x,y;chip.stereo(x,y);a+=x;b+=y;}held_left=a/count;held_right=b/count;}
        *l=silent?0:float(held_left);*r=silent?0:float(held_right);
        if(count&&pending){
            const uint32_t owned=source_pending&pending,starts=pending&~owned;pending=source_pending=0;
            for(uint8_t ch=0;ch<CHANNELS;++ch)if(starts&(1u<<ch))write(address(ch,0xb0),registers[address(ch,0xb0)]|32);
            uint8_t drums=0;for(uint8_t i=0;i<5;++i)if(starts&(1u<<(18+i)))drums|=16>>i;if(drums&&rhythm())write(0xbd,registers[0xbd]|drums);
            for(uint8_t ch=0;ch<23;++ch)if(owned&(1u<<ch))source_start(ch);
        }
    }
    int set_clock(uint32_t hz)override{if(hz<100000||hz>100000000)return 0;clock=hz;return 1;}
    uint8_t read(uint8_t offset)override{return chip.read(offset);}uint8_t status()override{return chip.read_status();}uint8_t irq()const override{return intf.irq_asserted?1:0;}
    void state(NativeExtraOplState*s)override{std::memcpy(s->registers,registers.data(),512);s->clock=clock;s->kind=kind;s->channels=CHANNELS;s->status=status();s->irq=irq();}
};
Base*core(void*p){return static_cast<Base*>(p);}
}
extern "C" {
void*native_extra_opl_create(uint32_t rate,uint8_t kind) { if(rate<8000||rate>384000) return nullptr; try { if(kind==0)return new Native<ymfm::ym3526>(rate,kind); if(kind==1)return new Native<ymfm::ym3812>(rate,kind); if(kind==2)return new Native<ymfm::ymf262>(rate,kind); if(kind==3)return new Native<ymfm::y8950>(rate,kind); } catch(...){} return nullptr; }
void native_extra_opl_destroy(void*p){delete core(p);} void native_extra_opl_reset(void*p){core(p)->reset();}
void native_extra_opl_all_notes_off(void*p){core(p)->all_off();}
void native_extra_opl_host_all_notes_off(void*p){core(p)->stop(false);} void native_extra_opl_stop(void*p){core(p)->stop(true);}
void native_extra_opl_write(void*p,uint16_t reg,uint8_t value){core(p)->write(reg,value);} void native_extra_opl_key_off(void*p,uint8_t voice){core(p)->off(voice,false);}
void native_extra_opl_key_off_fm(void*p,uint8_t ch){core(p)->off(ch,true);} void native_extra_opl_preview_key_off(void*p,uint8_t voice){core(p)->preview_off(voice);}
void native_extra_opl_audition_key_on(void*p,uint8_t voice){core(p)->audition(voice);} void native_extra_opl_cancel_csm(void*p){core(p)->cancel_csm();}
void native_extra_opl_source_preview_key_off(void*p,uint8_t voice){core(p)->source_preview_off(voice);}
void native_extra_opl_source_audition_key_on(void*p,uint8_t voice){core(p)->source_audition(voice);}
uint64_t native_extra_opl_memory_upload_revision(void*p){return core(p)->memory_upload_revision();}
uint64_t native_extra_opl_memory_revision(void*p){return core(p)->memory_revision();}
void native_extra_opl_memory_page(void*p,uint32_t index,uint8_t*page){core(p)->memory_page(index,page);}
void native_extra_opl_memory_length(void*p,uint32_t size){core(p)->memory_length(size);}
void native_extra_opl_cancel_adpcm(void*p){core(p)->cancel_adpcm();} void native_extra_opl_sample(void*p,float*l,float*r){core(p)->sample(l,r);}
uint8_t native_extra_opl_csm_active(void*p){return core(p)->csm()?1:0;}
uint8_t native_extra_opl_four_op_mask(void*p){return core(p)->pair_mask();}
uint8_t native_extra_opl_effective_register(void*p,uint16_t reg){return core(p)->effective_register(reg);}
void native_extra_opl_get_effective_registers(void*p,uint8_t*out){core(p)->effective_registers(out);}
int native_extra_opl_set_clock(void*p,uint32_t hz){return core(p)->set_clock(hz);} uint8_t native_extra_opl_read(void*p,uint8_t offset){return core(p)->read(offset);}
uint8_t native_extra_opl_read_status(void*p){return core(p)->status();} uint8_t native_extra_opl_get_irq(void*p){return core(p)->irq();}
void native_extra_opl_get_state(void*p,NativeExtraOplState*s){core(p)->state(s);}
}
