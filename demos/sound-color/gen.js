/**
 * 動作検証用の音を生成する
 */
import { readFile } from "node:fs/promises";
import { Ym2612, createYm2612 } from "../../web/ym2612.js";
import { YM2612Synth, YM2612DirectTransport, } from "../../web/ym2612synth.js";
import moduleFactory from "../../docs/generated/ym2612_wasm.js";

const main = async () => {
    console.log("start");
    const chip = await createYm2612(moduleFactory, {
        wasmBinary: await readFile(
            new URL("../../docs/generated/ym2612_wasm.wasm", import.meta.url)
        )
    });

    const synth = new YM2612Synth({
        transport: new YM2612DirectTransport(chip),
    });

    chip.generateStereo()
    console.log("end");
}
main();
