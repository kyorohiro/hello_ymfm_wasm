# SID共通factoryのnpm公開と使用例（2026-11-11）

ユーザー承認: SIDの共通factory対応をnpmの次のパッチ版へ公開し、`w/tetorica-fm2612-examples`に共通factoryで6581／8580を生成・発音・WAV出力する最小例を追加する。演奏helper／Preset一括適用／Round robin／Legato／Looper／Event Recの追加は対象外。

- [x] registryの現在versionとローカルの公開履歴を確認し、次のパッチ版を確定する。
- [x] SID共通factoryの短い使用例とREADME／検証導線をexamplesへ追加し、公開予定tarballから無音で検証する。
- [x] npmのversionを更新し、可読ソース・WASM・型・source kitを含む公開tarballをbuildする。
- [x] そのtarballを独立installして型・実PCM・ブラウザーAudioWorkletを検証し、公開対象のhashを固定する。
- [x] 検証したtarballをnpmへ公開し、registryから再取得してversion／integrity／全byte一致を確認する。必要な認証だけユーザーへ依頼する。
- [x] examplesの依存とlockを公開versionへ揃え、再確認して公開記録を残す。

境界: 音声出力は行わない。通常browser／native app／OS音量は操作しない。headlessの全destinationは起動前にgain0とする。公開済み0.2.38 tarballは変更しない。git commit／push／tagは今回の対象に含めない。

## 公開前の検証済み候補

- version: `0.2.39`。公開済みlatestは開始時点で0.2.38、0.2.39は未使用。
- tarball: `build/npm-sid-factory-release-20261111/tetorica-fm2612-0.2.39.tgz`（2,803,599 bytes／1,251 files）。SHA256 `fb82ffb75f40907e44a9e3672c83796a779a88e09a2a597f306b734da05db874`。
- そのtarballを独立installし、両modelのPCM／source kit／既定asset／型、headless Chromium／WebKitの実WASM／AudioWorkletを成功。別途既存全体package check（15 renderers／28 WASM）も成功。
- examplesは候補tarballでSID6 model casesと既定bothの連結一致、全50 Node examplesが成功。音声デバイス出力は除外し、WAV／event JSONのみ数値検証。
- `03-factory-wav`はNodeだけの短い1ファイル。既存2つのSID例を保持し、catalog／README／render scriptへ接続。依存とlockはregistry公開後に変更する。
- 追加認証を経てHTTP202で受理されたあと、registryのversion／latestが0.2.39となったことを確認。公開tarballは候補と全byte一致し、SHA1／SHA512 integrityも一致。認証URL・tokenは保存していない。

## 公開完了

`tetorica-fm2612@0.2.39`を公開し、registryのversion／latestを確認。公開tarballを再取得して候補との全byte一致、SHA1／SHA512 integrity一致を確認した。公開URL: https://www.npmjs.com/package/tetorica-fm2612/v/0.2.39 。

examplesの依存・lockを公開0.2.39へ更新。registry URL／integrityを確認し、SID6model cases＋既定bothのPCM連結一致、dist／docs静的buildが成功。両buildの全1545filesが同一で、新規example・SID factory／型／WASMもinstalled sourceとbyte一致。全50Node examplesは候補で成功し、その候補は公開tarballと同一。

公開照合・examples照合は`build/npm-sid-factory-release-20261111/registry-verification.json`と`examples-verification.json`へ保存。恒久記録: [npm_sid_factory_release_01.json](npm_sid_factory_release_01.json)。親repository／examplesともcommit／push／tagやPages公開はしていない。
