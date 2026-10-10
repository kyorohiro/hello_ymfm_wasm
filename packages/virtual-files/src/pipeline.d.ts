export type PipelineStage = {
    args: string[];
    input: string | null;
    output: {
        path: string;
        append: boolean;
    } | null;
};
/** @typedef {{args:string[],input:string|null,output:{path:string,append:boolean}|null}} PipelineStage */
/** Parse a sequential virtual-text pipeline. No expansion or host shell evaluation.
 * @param {string} source @returns {PipelineStage[]} */
export declare function parsePipeline(source: string): PipelineStage[];
