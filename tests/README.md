# Tests

End-to-end tests that drive the real app with Playwright against a small fake clip library.
They run in a Linux container (the cloud workspace), headless under xvfb.

## Setup (once per workspace)
- Copy the project (main.js, preload.js, package.json, renderer/, tools/, tests/, build/icon.png) and run `npm install`.
- Playwright must be installed globally (`npm i -g playwright`) and run with `NODE_PATH=$(npm root -g)`.

## Run
```
NODE_PATH=$(npm root -g) xvfb-run -a node tests/run.js           # everything
NODE_PATH=$(npm root -g) xvfb-run -a node tests/run.js overlay   # one test
NODE_PATH=$(npm root -g) xvfb-run -a node tests/run.js --gpu     # overlay also with software WebGPU
```
Each test prints PASS/FAIL with the checks that failed. Profiles, exports and the big scrolling
library are created in `tests/out/` (ignored by git).

## Tests
- `overlay.test.js`: quick trim end to end (open, play, keyboard trim, playhead trapped, mute, export video/audio, background-prepared copy, menus, saved trim, card length, card copy).
- `panel.test.js`: collapsing the overlay panel to the rail and back.
- `library.test.js`: card controls, right-click menu, old editor, scrolling behaviour with 64 clips.
- `style-snapshot.js`: not a pass/fail test; records computed styles in 11 states so a CSS cleanup can be proven to change nothing (`--compare a.json b.json`).

## Fixtures (`fixtures/`)
- `nv/`: NVIDIA-style per-game folders (Instant Replay `.DVR` names, a `Clips` subfolder, `peak.exe` exe-named folder, "Call of Duty  Black Ops 6" double-space name).
- `dc/`: Discord-style clips (`Game_<uuid>.mp4`), three with 4 audio tracks labelled `0:all`, `0:application` and two `<id>:voice`, one with no audio.
