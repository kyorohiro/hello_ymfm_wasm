// SPDX-License-Identifier: BSD-3-Clause
import {setupSynthMonacoEditor} from '../synth/synth_monaco_editor.js';
import {selectFm2610CodeDeclarations} from './code_declarations.js';

export function setupFm2610CodeEditor(options){
  return setupSynthMonacoEditor({...options,chip:'ym2610b',transformDeclarations:selectFm2610CodeDeclarations});
}
