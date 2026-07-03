# PuruPuru PNGTuber 全体コードレビュー

- レビュー日: 2026-07-03
- 対象: プロジェクトルート配下の全ソースコード、設定ファイル、ドキュメント、テストコード、アーキテクチャ全体
- レビュアー観点: 10年以上の経験を持つシニアソフトウェアエンジニア相当

## 検証結果

以下を実行し、すべて成功しました。

```text
node --check app.js
node --check standalone_drawing_avatar_export/standalone-drawing-avatar.js
node tests/js_runtime_checks.mjs
python -m py_compile scripts/run_local_server.py
python -m unittest tests.test_project_static
```

`python -m unittest tests.test_project_static` は 38 tests OK でした。

## Required

### [P0] 即時修正必須

該当なし。

### [P1] 次のリリースで: `.purupuru` 内JSONのサイズ検査が `JSON.parse()` より後

- ファイルパス:行番号
  - `app.js:1142-1143`
  - `app.js:2007`
  - `app.js:2015`
- 問題の説明
  - `.purupuru` 内の `manifest.json` / `settings.json` を、用途別のサイズ上限を確認する前に `JSON.parse()` しています。
- 理由
  - ZIP全体の上限はありますが、悪意ある大きなJSONにより、サニタイズ前の `JSON.parse()` でブラウザのUIスレッドが固まる可能性があります。
- 具体的な修正提案

```js
const MAX_MANIFEST_JSON_BYTES = 64 * 1024;
const MAX_SETTINGS_JSON_BYTES = 8 * 1024 * 1024;

function parseSettingsJson(raw, { maxBytes = MAX_SETTINGS_JSON_BYTES } = {}) {
  const text = String(raw ?? "");
  if (new Blob([text]).size > maxBytes) {
    throw new Error("設定JSONが大きすぎます。");
  }
  const parsed = sanitizeImportedJsonValue(JSON.parse(text));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("設定ファイルの形式が正しくありません。");
  }
  return parsed;
}
```

`manifestRaw.length` / `settingsRaw.length` も `u8ToText()` 前に検査してください。

### [P1] 次のリリースで: 単体お絵描き版のプロジェクトJSONが大きすぎる

- ファイルパス:行番号
  - `standalone_drawing_avatar_export/standalone-drawing-avatar.js:976-977`
- 問題の説明
  - 単体お絵描き版のプロジェクトJSONが最大80MBまで許容され、`JSON.parse(await file.text())` 後にサニタイズしています。
- 理由
  - ローカルファイル由来でも、80MB JSONはUIフリーズ・メモリ枯渇を起こしやすいです。
- 具体的な修正提案
  - `MAX_PROJECT_FILE_SIZE` を現実的な値へ下げる、またはノード数・配列長・文字列長の上限を本体版と同等に入れてください。

```js
const MAX_PROJECT_FILE_SIZE = 16 * 1024 * 1024;
const MAX_PROJECT_NODE_COUNT = 50000;
const MAX_PROJECT_STRING_LENGTH = 4 * 1024 * 1024;
```

### [P1] 次のリリースで: `.purupuru` 内サムネイルのサイズ・寸法検証不足

- ファイルパス:行番号
  - `app.js:2063-2066`
- 問題の説明
  - `.purupuru` 内サムネイルはPNG署名だけ確認し、サイズ・寸法検証なしで Data URL 化しています。
- 理由
  - 巨大な `thumbnail.png` を含むパッケージで、大きなBase64文字列が生成され、IndexedDB/DOM/メモリを圧迫します。
- 具体的な修正提案

```js
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const MAX_THUMBNAIL_EDGE = 1024;

function validateThumbnailU8(u8, name) {
  if (u8.length > MAX_THUMBNAIL_BYTES) throw new Error("サムネイルが大きすぎます。");
  const { w, h } = pngU8Dimensions(u8, name);
  if (w > MAX_THUMBNAIL_EDGE || h > MAX_THUMBNAIL_EDGE) {
    throw new Error("サムネイル寸法が大きすぎます。");
  }
}
```

読み込んだサムネイルを信用せず、アバター画像から再生成する方が安全です。

## Recommended

### [P2] 将来的に: サムネイル生成が元アバター解像度のまま

- ファイルパス:行番号
  - `app.js:3468-3485`
- 問題の説明
  - `buildAvatarCompositeThumbnailDataUrl()` が元アバター解像度のままサムネイルを生成しています。
- 理由
  - 最大4096px級アバターでは、サムネイル用途に対して過大なCanvas/Data URLが作られ、保存容量と描画性能を悪化させます。
- 具体的な修正提案
  - 256〜512px程度へ縮小してから保存してください。

### [P2] 将来的に: 単体お絵描き版のUndo履歴にバイト上限がない

- ファイルパス:行番号
  - `standalone_drawing_avatar_export/standalone-drawing-avatar.js:9`
  - `standalone_drawing_avatar_export/standalone-drawing-avatar.js:505`
  - `standalone_drawing_avatar_export/standalone-drawing-avatar.js:514`
  - `standalone_drawing_avatar_export/standalone-drawing-avatar.js:523`
- 問題の説明
  - 単体お絵描き版のUndo履歴が枚数制限のみで、バイト上限がありません。
- 理由
  - 1024x1536の `ImageData` は1枚約6MBで、30履歴だけで約180MB規模になります。本体側には `app.js:96` のようなバイト上限があります。
- 具体的な修正提案
  - 本体版と同様に `MAX_HISTORY_BYTES` を導入し、古い履歴を削除してください。

### [P2] 将来的に: `app.js` が巨大な単一IIFE

- ファイルパス:行番号
  - `app.js:1`
  - `app.js:9256`
  - `app.js:12269`
- 問題の説明
  - `app.js` が約14,000行の単一IIFEで、描画・状態管理・保存・OBS・顔追跡・お絵描きが密結合しています。
- 理由
  - 変更影響範囲が広く、テストも文字列抽出に依存しやすくなっています。
- 具体的な修正提案
  - まず以下へ分割するのが最善です。
    1. `storage/package.js`
    2. `rendering/avatar-renderer.js`
    3. `drawing/drawing-avatar.js`
    4. `obs/obs-client.js`
    5. `tracking/face-tracker.js`

### [P2] 将来的に: 実ブラウザE2Eが不足

- ファイルパス:行番号
  - `tests/test_project_static.py:577`
  - `.github/workflows/ci.yml:34-45`
- 問題の説明
  - CIは構文検査・静的文字列検査中心で、実ブラウザ上の主要フローを検証していません。
- 理由
  - Canvas描画、IndexedDB、ファイル取込、OBS API、MediaDevices権限まわりは静的テストだけでは回帰を検出しにくいです。
- 具体的な修正提案
  - Playwright等で最低限のスモークテストを追加してください。
    - 起動して `statusPill` が ready になる
    - `.purupuru` import/exportの最小ケース
    - OBS snapshot API
    - お絵描きパネルの起動とUndo/Redo

### [P2] 将来的に: Vendored依存物のチェックサム・更新手順が不足

- ファイルパス:行番号
  - `THIRD_PARTY_NOTICES.md:5`
  - `vendor/mediapipe/tasks-vision/0.10.35/package.json:2`
- 問題の説明
  - Vendored MediaPipe/WASM/model のチェックサム・取得元・更新手順が記録されていません。
- 理由
  - 依存物をリポジトリ内に固定しているため、供給元検証と更新監査が手作業になっています。
- 具体的な修正提案
  - `vendor/mediapipe/SHASUMS256.txt` と更新スクリプト、取得元URL、検証手順を追加してください。

## Optional

### [P3] Nice-to-have: ローカルサーバーが `.purupuru` を静的配信対象に含めている

- ファイルパス:行番号
  - `scripts/run_local_server.py:150`
  - `scripts/run_local_server.py:266`
- 問題の説明
  - ローカルサーバーが `.purupuru` を静的配信対象に含めています。
- 理由
  - 通常はファイルピッカーで読み込むため、静的配信の必要性が低く、ローカルのプライベートパッケージを誤って配信対象にする余地があります。
- 具体的な修正提案
  - `.purupuru` を `allowed_extensions` から外すか、明示的なfixtures用途だけ許可してください。

### [P3] Nice-to-have: インポート由来の表示名に長さ制限がない

- ファイルパス:行番号
  - `app.js:2792`
  - `app.js:2798`
- 問題の説明
  - インポート設定由来のアイテム `name` / `label` を長さ制限なしでUIへ反映しています。
- 理由
  - XSSは `textContent` 中心で抑えられていますが、巨大文字列によるUI肥大が起こり得ます。
- 具体的な修正提案

```js
function safeDisplayText(value, fallback, max = 120) {
  const text = String(value || fallback).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text.slice(0, max) || fallback;
}
```

## 全体の強み

- CSP、`nosniff`、`Permissions-Policy`、API Host/Origin検査が入っており、ローカルアプリとしての基本防御は良好です。
- `.purupuru` のパストラバーサル、ZIP件数・サイズ、CRC検査が実装されています。
- CIがWindows/macOS/Linuxで走り、主要な静的検査が整備されています。
- 画像サイズ・PNG形式・プロトタイプ汚染対策が意識されています。

## 推奨リファクタリングの優先順位トップ3

1. **Best**: 外部JSON/サムネイル取込のサイズ検証を `JSON.parse` / Data URL化の前に追加する。
2. **Second-best**: `app.js` を保存・描画・OBS・顔追跡・お絵描きモジュールへ分割する。
3. **Not recommended**: 実ブラウザE2Eなしのまま機能追加を続けること。最低限のPlaywrightスモークを追加してください。
