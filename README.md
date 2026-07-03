# ぷるぷる PNGTuber / PuruPuru PNGTuber

<p align="center"><strong>表情差分PNG + 前髪 + 後ろ髪で、リッチに動くPNGTuberを作る。</strong></p>
<p align="center"><strong>Expression PNGs + front hair + back hair = a richer moving PNGTuber avatar.</strong></p>

<p align="center">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue">
  <img alt="Runs locally" src="https://img.shields.io/badge/Runs-locally-brightgreen">
  <img alt="PNG only" src="https://img.shields.io/badge/Avatar-PNG%20only-orange">
  <a href="https://github.com/sponsors/rotejin"><img alt="Sponsor rotejin" src="https://img.shields.io/badge/Sponsor-rotejin-ea4aaa?logo=githubsponsors&logoColor=white"></a>
</p>

<p align="center">
  <img src="./docs/images/purupuru.gif" alt="PuruPuru PNGTuber demo" width="720">
</p>

## 概要 / Overview

ぷるぷるPNGTuberは、通常のPNGTuber向け表情差分PNGに「前髪」と「後ろ髪」の2枚を追加するだけで、髪揺れ・顔向き・口パク・まばたきに対応したリッチなPNGTuberアバターを作るためのローカルWebアプリです。

このリポジトリは、**Codex / Claude Code などのAIコーディングエージェントに初期セットアップを依頼し、その後ユーザーがブラウザ上で微調整する** ワークフローを前提にしています。

PuruPuru PNGTuber is a local browser app for creating expressive PNGTuber avatars. Add only front-hair and back-hair layers to ordinary PNGTuber expression images, ask Codex, Claude Code, or another coding agent to set up the initial character, then fine-tune it visually in the browser.

## 想定ワークフロー / Workflow

1. PNG素材を用意する
   - 通常のPNGTuber向け表情差分
   - `front-hair.png` 相当の前髪
   - `back-hair.png` 相当の後ろ髪
   - 任意でボディ、ヘアアクセサリ、リボンなどのPNGアイテム
2. Codex / Claude Code などに初期セットアップを依頼する
   - ファイル名整理
   - `assets/` 配下への配置
   - キャラ設定・初期位置・髪束ライン・アイテム設定の作成
3. ローカルで起動して確認する
4. ブラウザ上で表情、顔向き、髪揺れ、アイテム位置を微調整する
5. `.purupuru` ファイルとして保存・バックアップする

English summary:

1. Prepare aligned transparent PNG assets.
2. Ask Codex, Claude Code, or another coding agent to create the initial character setup.
3. Run the app locally.
4. Fine-tune the avatar in the browser.
5. Export a `.purupuru` package for backup or transfer.

## 用意する素材 / Required images

必須PNG:

```text
back-hair.png                 後ろ髪 / back hair
front-hair.png                前髪 / front hair
eyes-open-mouth-closed.png    目開け・口とじ
eyes-open-mouth-half.png      目開け・口中間
eyes-open-mouth-open.png      目開け・口開け
eyes-closed-mouth-closed.png  目閉じ・口とじ
eyes-closed-mouth-half.png    目閉じ・口中間
eyes-closed-mouth-open.png    目閉じ・口開け
```

任意PNG:

```text
body.png      ボディ
hairpin.png   ヘアアクセサリ
ribbon.png    リボン
その他アイテムPNG
```

重要:

- すべて透過PNGにしてください。
- 同じキャラ内のPNGは、同じキャンバスサイズ・同じ位置合わせにしてください。
- 顔、目、口、前髪、後ろ髪、ボディ、アクセサリの座標がズレていると、まばたき・口パク・顔向き・髪揺れ時にズレが目立ちます。
- 前髪と後ろ髪は、顔画像と同じキャンバス基準で書き出してください。

詳しい使い方は [使い方 / Usage](./docs/usage.md) を参照してください。

## AIに依頼する / Ask Codex or Claude Code

キャラ追加時は、次のような依頼文を使う想定です。

```text
このフォルダ内のPNG素材を使って、PuruPuru PNGTuber用の新キャラとして追加してください。

条件:
- 素材は assets/ 以下にASCII名でコピーしてください。
- 表情差分、前髪、後ろ髪を対応するファイル名にリネームしてください。
- 追加アイテムがある場合は items/ 以下に保存してください。
- default-settings.json を作成し、顔中心、目、鼻、口、顎、首支点、髪束ラインを初期設定してください。
- ボディやアクセサリがある場合は、初期アイテムとして登録してください。
- キャラ固有の髪/顔補正が必要な場合は、既存キャラに影響しないようキャラ固有条件で分岐してください。
- 最後に node --check app.js と関連テストを実行してください。
```

詳しい依頼手順は [使い方 / Usage](./docs/usage.md) を参照してください。

## 主な機能 / Features

- PNGだけで動くPNGTuberアバター
- 表情差分 + 前髪 + 後ろ髪によるリッチな見た目
- マイク音量またはデモによる口パク
- 自動まばたき
- マウス追従とカメラ顔トラッキング（既定はCPU・最大15fpsの安全設定）
- PNG素材なしで作れるブラウザ内お絵描き新キャラ作成
- 前髪・後ろ髪のぷるぷる揺れ
- 顔向き、ハイライト、涙レンズ、影の調整
- PNGアイテムの追加、前後関係、追従、ロック
- OBS向け透過表示
- `.purupuru` avatar package import/export
- Advanced warp editor for face and hair adjustment

## クイックスタート / Quick start

### Requirements

- Python 3.10 or later
- Google Chrome or Chromium recommended
- Camera permission for face tracking
- Microphone permission for microphone lip sync
- MediaPipe face tracking assets are vendored under `vendor/mediapipe/`

Face tracking uses the CPU delegate by default and limits detection to 15fps to reduce long-running GPU memory risk. If you intentionally want to test the GPU delegate, append `?faceDelegate=gpu` or `?face-delegate=gpu` to the local URL.

### Windows

```powershell
.\run_local_server.bat
```

or:

```powershell
python scripts\run_local_server.py
```

### macOS / Linux

```bash
chmod +x ./run_local_server.sh
./run_local_server.sh
```

or:

```bash
python3 scripts/run_local_server.py
```

The app opens at a local URL such as:

```text
http://127.0.0.1:8223/
```

Use the local server instead of opening `index.html` directly with `file://`. Browser permissions, CSP, and OBS helper APIs behave more consistently through the local server.

## 同梱デモアバター / Demo assets

Bundled demo avatars are stored in:

```text
assets/demo-avatar/
assets/demo-avatar02/
assets/demo-avatar03/
```

The bundled demo images are provided so the app can be tested immediately after cloning. Avatar PNGs can use different canvas sizes per character, as long as every required PNG in the same character uses the same size and alignment.

Bundled demo images, favicon, screenshots, thumbnails, and other visual assets are licensed separately from the software code. See [ASSET_LICENSE.md](./ASSET_LICENSE.md).

## 使い方 / Usage

詳しい使い方、素材準備、Codex / Claude Code への依頼例、OBS設定、トラブルシュートは1本にまとめています。

- [使い方 / Usage](./docs/usage.md)

## 開発者向け / Development checks

```bash
node --check app.js
node --check standalone_drawing_avatar_export/standalone-drawing-avatar.js
node tests/js_runtime_checks.mjs
python -m py_compile scripts/run_local_server.py
python -m py_compile scripts/verify_vendor_checksums.py
python scripts/verify_vendor_checksums.py
python -m unittest tests.test_project_static
```

## Privacy

PuruPuru PNGTuber runs locally in your browser. Camera and microphone data are processed locally for the app's features. Face tracking loads vendored MediaPipe assets from `vendor/mediapipe/` at runtime when you enable camera tracking. Face tracking defaults to the CPU delegate; GPU is opt-in via `?faceDelegate=gpu`.

Camera-based face tracking is powered by Google MediaPipe Tasks Vision, licensed under Apache License 2.0. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./.github/CONTRIBUTING.md), [SECURITY.md](./.github/SECURITY.md), and [SUPPORT.md](./.github/SUPPORT.md) before opening issues or pull requests.

## License

Software code and documentation text are licensed under the [Apache License 2.0](./LICENSE).

Bundled demo avatar images, favicon, screenshots, thumbnails, and other visual assets are not covered by the software license. They are governed separately by [ASSET_LICENSE.md](./ASSET_LICENSE.md).

Third-party notices are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
