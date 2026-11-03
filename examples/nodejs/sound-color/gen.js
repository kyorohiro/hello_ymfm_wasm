/**
 * 動作検証用の音を生成する
 */
import { readFile } from "node:fs/promises";
import { createYm2612 } from "../../../web/ym2612.js";
import { YM2612Synth, YM2612DirectTransport } from "../../../web/ym2612synth.js";
import { FM_PRESETS } from "../../../web/megasynth-fm-presets.js";
import moduleFactory from "../../../web/generated/ym2612_wasm.js";

const main = async () => {
    console.log("start");
    const chip = await createYm2612(moduleFactory, {
        wasmBinary: await readFile(
            new URL("../../../web/generated/ym2612_wasm.wasm", import.meta.url)
        )
    });

    try {
        const synth = new YM2612Synth({
            transport: new YM2612DirectTransport(chip),
        });
        synth.setPreset(0, FM_PRESETS.sine);
        synth.noteOn(0, 69);
        const pcm = chip.generateStereo(128);
        synth.noteOff(0);
        if (!pcm.left.every(Number.isFinite) || !pcm.right.every(Number.isFinite)) {
            throw new Error("YM2612 generated non-finite PCM");
        }
        const peak = Math.max(...pcm.left.map(Math.abs), ...pcm.right.map(Math.abs));
        console.log(`Generated ${pcm.left.length} stereo frames; peak=${peak}`);
        console.log("end");
    } finally {
        chip.dispose();
    }
}
main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
