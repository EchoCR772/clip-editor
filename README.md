# Clip Editor

Trim and share your game clips. Clip Editor finds your NVIDIA (ShadowPlay / Instant Replay) and Discord clips by itself, groups them by game, and lets you trim one and paste it straight into Discord.

## Download
Get the latest **Clip-Editor-Setup-x.y.z.exe** from [Releases](https://github.com/EchoCR772/clip-editor/releases/latest) and run it.

Windows will probably say "Windows protected your PC" the first time, because the app isn't code-signed. Click **More info**, then **Run anyway**. Updates after that install by themselves: when one is ready, a green **Update ready** button shows up at the top of the window.

## What it does
- Library of your NVIDIA and Discord clips, by game, with previews on hover
- Trim with a Discord-style editor; trims are saved and the original file is never touched
- Mute or turn down the game, your mic, or each person in a Discord call separately
- Copy Video (then Ctrl+V in Discord), drag a clip into Discord, or Export a file
- Fast exports at the original quality: only the frames around the cut points are re-encoded
- Rename clips inside the app; copies and exports use the name

Windows 10/11, 64-bit. Uses the graphics card for video when it can (NVIDIA, AMD or Intel).

## Building
```
npm install
npm start                # run from source
npx electron-builder --win nsis
```
Tests: see [tests/README.md](tests/README.md).

## License
MIT (see [LICENSE](LICENSE)). Third-party parts, including FFmpeg (GPL), are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
