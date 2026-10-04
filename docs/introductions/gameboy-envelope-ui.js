import {ENVELOPE_DEFAULTS, lessonCode, renderLesson, amplitudeTrace} from './gameboy-lessons.js';
import {attachLesson, blankCanvas, drawTrace} from './gameboy-lesson-player.js';
const form = document.querySelector('#lesson-controls');
const canvas = document.querySelector('#waveform');
const read = () => ({volume: Number(form.elements.volume.value), direction: form.elements.direction.value, period: Number(form.elements.period.value)});
const player = attachLesson({read, code: s => lessonCode('envelope', s), render: (s, options) => renderLesson('envelope', s, options),
  reset() { for (const [key, value] of Object.entries(ENVELOPE_DEFAULTS)) form.elements[key].value = value; },
  clear: () => blankCanvas(canvas, '再生すると、PCMから測った振幅を表示します'),
  draw(pcm) {
    const s = read();
    drawTrace(canvas, amplitudeTrace(pcm.left, pcm.sampleRate), {max: .25, duration: '2 秒',
      label: `生成PCMの10 msごとの最大値−最小値。初期音量${s.volume}、${s.direction}、周期${s.period}。0〜2秒、固定振幅スケール。`});
  },
});
form.addEventListener('input', player.update);
form.addEventListener('submit', event => event.preventDefault());
