# Tetorica 8580 Research Lab

An experimental PAL, single-SID C64 machine with the separate MIT sidera 8580
model. Open `index.html` through localhost or HTTPS. Load one of the three
original demos, then press Play. The existing 6581 SID Player remains separate.

This page accepts PSID/RSID v2. It retains the file's declared model and clock;
unknown/either hints need the explicit PAL/8580 choices. Declared 6581, NTSC,
multiple SID, MUS and unsupported program layouts are rejected. The minimal
environment uses the original Tetorica boot/interrupt shim. No Commodore ROM
or game music is included. The lower-level Core can receive caller-supplied
firmware; this page does not provide a firmware uploader or BASIC environment.

The pristine C64 CPU, CIA, VIC and memory/bank logic clock a compatibility SID
endpoint. Its actual 8580 reads are returned to the CPU. The machine WASM
imports exported WebAssembly functions directly from the SID WASM; no
JavaScript closure runs for every chip cycle and no recorded trace replaces
execution. The two modules own separate memories. Native links the same SID
source as a Rust static library.

The output chain is the model's external RC, integer sample selection and the
original host's additional **12-Hz software DC blocker**, followed by the user
Master. This is distinct from the earlier isolated filter measurements.
The resonance and cutoff profiles are independent software reference fits,
both off by default. Changes to the checkboxes apply on Play/restart.

Live voice envelope/phase inspection is unavailable. Displayed OSC3/ENV3
observations are cached **actual CPU reads**, not new bus reads performed by
the UI. POT reads and mapped expansion hardware are explicitly unsupported.
Snapshots of a running C64 are not exposed because they would copy ownership
of the opaque SID handle. Stop clears audio; Play reloads the chosen subtune.

A failed or cancelled candidate selection retains the previous valid sound.
The Worklet reports render time separately from synchronous load preflight.
Those diagnostics and the automated finite-duration tests do not establish
long-session stability, glitch-free switching, actual-chip accuracy or
listening quality. This is an explicit research entry, not production model
adoption or a relaxation of the existing player's 8580 rejection.

The authored JavaScript, CSS, C/C++/Rust source, generators, licenses and build
receipts remain readable. See `scripts/build_sid8580_machine.sh`,
`scripts/sid8580_machine_artifacts.mjs` and
`scripts/package_sid8580_machine.mjs` in the repository/source kit.
