# Third-Party Notices

PuruPuru PNGTuber vendors the MediaPipe face-tracking runtime assets used by the optional camera tracking feature so the app does not need to execute JavaScript from external CDNs at runtime.

## Vendored libraries and model assets

### MediaPipe Tasks Vision

- Project: MediaPipe Tasks Vision / Face Landmarker
- Provider: Google
- Version referenced by the app: `@mediapipe/tasks-vision@0.10.35`
- Runtime module path: `vendor/mediapipe/tasks-vision/0.10.35/vision_bundle.mjs`
- Runtime WASM path: `vendor/mediapipe/tasks-vision/0.10.35/wasm/`
- Face Landmarker model path: `vendor/mediapipe/face_landmarker/float16/face_landmarker.task`
- License: Apache License 2.0

MediaPipe assets are loaded from the local `vendor/` directory at runtime only when camera-based face tracking is used. If face tracking is not used, the core PNG avatar rendering can still run without loading MediaPipe.

### Zen Maru Gothic

- Font: Zen Maru Gothic
- Author: Yoshimichi Ohira
- Source: Google Fonts (https://fonts.google.com/specimen/Zen+Maru+Gothic)
- License: SIL Open Font License, Version 1.1 (see `vendor/fonts/zen-maru-gothic/OFL.txt`)
- Vendored path: `vendor/fonts/zen-maru-gothic/` (woff2 subsets + `fonts.css`)

The CSP (`style-src 'self'`) prevents loading fonts from the Google Fonts CDN at runtime, so the woff2 files and `@font-face` definitions are vendored locally and loaded via `vendor/fonts/zen-maru-gothic/fonts.css`.

## Browser and platform APIs

The app uses standard browser APIs including Canvas 2D, WebGL, MediaDevices, Web Audio, FileReader, localStorage, EventSource, and fetch.
