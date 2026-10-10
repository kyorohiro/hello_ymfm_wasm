import {lessonText} from './introduction-locale.js';
import {ENVELOPE_DEFAULTS, lessonCode, renderLesson, amplitudeTrace} from './gameboy-lessons.js';
import {attachLesson, blankCanvas, drawTrace} from './gameboy-lesson-player.js';
const form = document.querySelector('#lesson-controls');
const canvas = document.querySelector('#waveform');
const read = () => ({volume: Number(form.elements.volume.value), direction: form.elements.direction.value, period: Number(form.elements.period.value)});
const player = attachLesson({read, code: s => lessonCode('envelope', s), render: (s, options) => renderLesson('envelope', s, options),
  reset() { for (const [key, value] of Object.entries(ENVELOPE_DEFAULTS)) form.elements[key].value = value; },
  clear: () => blankCanvas(canvas, lessonText('再生すると、PCMから測った振幅を表示します', 'Play to display the amplitude measured from PCM.')),
  draw(pcm) {
    const s = read();
    drawTrace(canvas, amplitudeTrace(pcm.left, pcm.sampleRate), {max: .25, duration: lessonText('2 秒', '2 s'),
      label: lessonText(`生成PCMの10 msごとの最大値−最小値。初期音量${s.volume}、${s.direction}、周期${s.period}。0〜2秒、固定振幅スケール。`, `Generated PCM peak-to-peak in 10 ms windows. Initial volume ${s.volume}, ${s.direction}, period ${s.period}. 0–2 seconds; fixed amplitude scale.`)});
  },
});
form.addEventListener('input', player.update);
form.addEventListener('submit', event => event.preventDefault());
