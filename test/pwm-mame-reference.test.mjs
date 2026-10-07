import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PWM32X} from '../web/pwm32x.js';

// Compile the actual pinned MAME function bodies, with only host devices stubbed.
// This oracle does not duplicate the JS FIFO algorithm.
test('FIFO, routing, reconfiguration and interrupt cadence match pinned MAME functions', async t => {
  const compiler = process.env.CXX || 'c++';
  if (spawnSync(compiler,['--version']).status !== 0) {t.skip('C++ compiler unavailable');return;}
  const source=await readFile(new URL('../third_party/mame-32x-pwm/upstream/mega32x.cpp',import.meta.url),'utf8');
  const bodies=['void sega_32x_device::calculate_pwm_timer()','void sega_32x_device::lch_pop()',
    'void sega_32x_device::rch_pop()','TIMER_CALLBACK_MEMBER(sega_32x_device::handle_pwm_callback)',
    'uint16_t sega_32x_device::pwm_r(offs_t offset)','void sega_32x_device::pwm_w(offs_t offset, uint16_t data)'].map(signature=>{
      const start=source.indexOf(signature);assert.ok(start>=0);let end=source.indexOf('{',start),depth=1;
      while(depth){end++;if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
      return source.slice(start,end+1);
    }).join('\n');
  const directory=await mkdtemp(join(tmpdir(),'pwm-mame-reference-'));
  try{
    const cpp=`// BSD-3-Clause; MAME function bodies: copyright David Haywood.
#include <cstdint>
#include <iostream>
#define TIMER_CALLBACK_MEMBER(name) void name()
#define popmessage(...) ((void)0)
#define logerror(...) ((void)0)
#define SH2_PINT_IRQ_LEVEL 6
#define ASSERT_LINE 1
using offs_t=unsigned;
struct attotime { bool enabled; static const attotime never; static attotime from_hz(unsigned){return {true};} }; const attotime attotime::never={false};
struct Timer {bool active=false; void adjust(attotime time){active=time.enabled;}};
struct Stream {void update(){}};
struct DAC {int value=-1;void write(unsigned v){value=v;}};
struct CPU {void set_input_line(int,int){}};
struct Machine {bool side_effects_disabled(){return false;}};
struct sega_32x_device {
 static constexpr int PWM_FIFO_SIZE=3;
 uint16_t m_pwm_ctrl=0,m_pwm_cycle=0,m_pwm_tm_reg=0,m_pwm_cycle_reg=0;
 uint16_t m_cur_lch[3]{},m_cur_rch[3]{},m_lch_fifo_state=0x4000,m_rch_fifo_state=0x4000;
 uint8_t m_pwm_timer_tick=0,m_lch_size=0,m_rch_size=0;
 int m_sh2_master_pwmint_enable=0,m_sh2_slave_pwmint_enable=0;
 Timer timer;Timer* m_32x_pwm_timer=&timer;Stream stream;Stream* m_stream=&stream;
 DAC ldac,rdac;DAC* m_ldac=&ldac;DAC* m_rdac=&rdac;CPU cpu;CPU* m_master_cpu=&cpu;CPU* m_slave_cpu=&cpu;
 unsigned clock(){return 1000;}Machine machine(){return {};}
 void calculate_pwm_timer();void lch_pop();void rch_pop();void handle_pwm_callback();uint16_t pwm_r(offs_t);void pwm_w(offs_t,uint16_t);
};
${bodies}
int main(){sega_32x_device p;char op;unsigned reg,value;while(std::cin>>op>>reg>>value){if(op=='w')p.pwm_w(reg,value);else if(p.timer.active)p.handle_pwm_callback();
 std::cout<<p.ldac.value<<' '<<p.rdac.value<<' '<<p.pwm_r(2)<<' '<<p.pwm_r(3)<<' '<<p.pwm_r(1)<<' '<<unsigned(p.m_pwm_timer_tick)<<'\\n';}}
`;
    await writeFile(join(directory,'reference.cpp'),cpp);
    const compile=spawnSync(compiler,['-std=c++17',join(directory,'reference.cpp'),'-o',join(directory,'reference')],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
    const actions=[['w',0,0x205],['w',1,5],...Array.from({length:4},(_,i)=>['w',2,1024+i*512]),['w',3,3072],
      ...Array.from({length:5},()=>['t',0,0]),['w',0,10],['w',4,2560],['t',0,0],['w',4,2048],['w',1,7],['t',0,0],
      ['w',0,0],['w',1,0],['w',4,1024],['w',0,0x305],['w',4,3072],['t',0,0],['t',0,0],['t',0,0],['w',1,1],['w',4,2048],['t',0,0]];
    const result=spawnSync(join(directory,'reference'),[],{input:actions.map(a=>a.join(' ')).join('\n')+'\n',encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const expected=result.stdout.trim().split('\n').map(row=>row.split(' ').map(Number));
    const p=new PWM32X({clock:1000,sampleRate:1000});
    for(let i=0;i<actions.length;i++){
      const [op,reg,value]=actions[i];if(op==='w')p.write(reg,value);else p.generateStereo(p.active()?p.cycle-1:1);
      assert.deepEqual([p.left??-1,p.right??-1,p.read(2),p.read(3),p.read(1),p.timerTick],expected[i],`trace event ${i}`);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
