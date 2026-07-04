# PuruPuruPNGTuber 全体コードレビュー

- **対象**: プロジェクトルート配下 全ソース・設定・ドキュメント・テスト
- **ブランチ**: `feature/ui-redesign-yawaraka-modern`
- **実施日**: 2026-07-04
- **方法**: 7領域を並列でシニアレビュー（app.js 5分割 + HTML/CSS + Python/tests/CI/standalone）し、主要指摘は実コードで再検証・優先度付け

---

## 総評

ビルド工程を持たない**純クライアントサイド静的サイト**（`app.js` 14,221行のIIFE中核 + MediaPipe WASM顔追跡 + 自前ZIP `.purupuru` 入出力 + IndexedDB/localStorage 永続化 + OBSモード限定のローカルPythonサーバー連携）。

セキュリティ設計の水準が非常に高く、**即時修正必須（P0）の脆弱性は発見されませんでした**。信頼できない入力（インポート zip / JSON / PNG / data URL）に対する多層検証、プロトタイプ汚染対策、外部送信ゼロ、`innerHTML` / `eval` 不使用、厳格で実効性のある CSP が揃っています。指摘の重心は**パフォーマンス（描画ホットループのアロケーション）とアクセシビリティ、および一部の状態整合バグ**にあります。

### 優先度サマリ

| 優先度 | 件数 | 主な内容 |
|---|---|---|
| P0 即時修正必須 | 0 | 該当なし |
| P1 次のリリースで | 3 | パッケージ展開DoS / キャラ削除ID不整合 / コントラストAA不適合 |
| P2 計画的に | 12 | 描画ループのアロケーション / 強制リフロー / autosave堅牢化 / a11yランドマーク / テスト穴 ほか |
| P3 将来的に | 多数 | 個別の最適化・保守性・a11y細目 |

---

## [P0] 即時修正必須

**該当なし。** 主要な攻撃面（ZIPパス走査・プロトタイプ汚染・PNG検証・ローカルサーバー）を敵対的に検証しましたが、悪用可能な穴は見つかりませんでした。残存リスクは下記 P1-1 のクライアント側 DoS です。

---

## [P1] 次のリリースで修正すべき

### P1-1. アイテムレイヤー展開のメモリ増幅DoS

- **場所**: `app.js:2079-2097`（`parsePuruPuruPackageBlob`）※実コード検証済み
- **問題**: `itemLayers` を**件数上限なし**（sanitize の配列上限 2000 まで）で `map` し、各レイヤーで `pngU8ToBlob` と `u8ToPngDataUrl` を実行する。`layer.file` は同一 zip エントリを重複参照できるため、**3MBのPNG 1枚＋それを指す 2000 レイヤー**の settings.json（約100KBで8MB制限内、zipエントリ数も数個で256制限内）で、返り値に 2000 ×(3MB Blob + 4MB data URL 文字列)≒ **8〜14GB を同時保持**しようとしてタブが OOM／クラッシュする。
- **理由**: 本アプリの脅威モデルは「他者作成の `.purupuru` 読み込み」を明示的に含む（「ファイルから追加」ボタン）。上限 `MAX_ITEM_LAYER_COUNT=20` は存在するが、適用は `restoreItemLayers`（`app.js:2882`）の後段のみで、巨大確保が完了する **parse 段階では実質バイパス**される。avatar 画像は8キー固定で境界があるが、itemLayers だけ無防備。
- **修正案**: parse 時点で件数スライスし、累積デコードバイト上限も設ける。
  ```js
  if (Array.isArray(settingsPayload.itemLayers)) {
    const capped = settingsPayload.itemLayers.slice(0, MAX_ITEM_LAYER_COUNT);
    let itemBytesTotal = 0;
    hydratedSettingsPayload.itemLayers = capped.map((layer, index) => {
      // ... itemU8 取得後:
      itemBytesTotal += itemU8.length;
      if (itemBytesTotal > MAX_PURUPURU_UNZIPPED_SIZE) throw new Error("PNGアイテムの合計が大きすぎます。");
      // ...
    });
  }
  ```

### P1-2. アクティブキャラ削除後の `activeCharacterId` 不整合で保存が恒久停止

- **場所**: `app.js:4357-4366`（`deleteCharacterProfile`）※実コード検証済み
- **問題**: アクティブキャラ削除時、`deleteCharacterProfileRecord(targetId)`（4357）成功後に `applyCharacterProfileRecord(fallbackRecord)`（4361）が例外を投げると、`activeCharacterId = fallbackRecord.id`（4362）に到達せず、`activeCharacterId` が**削除済みID**を指したまま catch へ抜ける（4370-4379 の finally でも再整合しない）。
- **理由**: 以後の autosave は存在しないIDで `patchCharacterProfile → getCharacterProfile()=undefined → throw` となり、**「保存失敗」表示のまま編集が永続化されない**。手動でキャラ切替するまで復旧せず、その間にタブを閉じると編集が失われる。fallback レコードが過去の部分保存で壊れていると現実に踏む。
- **修正案**: 削除成功後に apply が失敗しても、`activeCharacterId` を必ず生存プロファイル（`fallbackProfile.id` か `characterProfilesCache[0]?.id`）へ再設定し `rememberActiveCharacterId` も更新してから UI 更新する。「削除済みだがアクティブが不明」の状態を残さない。

### P1-3. 二次テキスト色 `--muted` がWCAG AAコントラスト不足

- **場所**: `styles.css:9`（`--muted:#9a8a7a`）＋広範な使用箇所（`.small-note` 1309, `.item-sub` 1229, `.readout` 1299, `.live-readout` 1622 ほか）※実測検証済み
- **問題**: 白/クリーム地 `--bg:#fff8ee` 上のコントラストは**実測 約 3.17:1**（AA基準 4.5:1 に対し不足）。注記・メタ情報は 10〜11px の小サイズで大文字緩和の対象外。ダーク版 `rgba(242,232,220,0.5)` も約 3.8:1 で不足。
- **理由**: 注記・数値 readout・メタ情報が広範に読みづらく、アクセシビリティの AA 不適合が製品全体に散在する。
- **修正案**: ライトは `#6f5f50` 相当（≥4.5:1）、ダークは不透明度を 0.5 → 0.7 以上へ。

---

## [P2] 計画的に修正すべき

### パフォーマンス

**P2-1. 描画ホットループの毎フレームアロケーション＋冗長再計算** — `app.js:9962`（`deformerWarpPoint`）／`9939`（`interpolatedControlPoint`）※検証済み
`deformerWarpPoint` は頂点ごとに `interpolatedControlPoint` を4回、各々が `keyPoint` を3回（各 `{x,y}` 生成）呼ぶ。**制御点は25個しかないのに 117頂点×3レイヤー×60fps で毎フレーム1万個超の短命オブジェクト＋約19倍の冗長計算**。`warpInfo`/`faceWarpPoint`/`highlightWarpPoint`（`10017` 他）も同様に頂点ごとに `{x,y}` を返す。髪バネ経路はスクラッチ再利用済みなのでパターンは既知。
→ 25制御点を `motionFrameId` キーでフレーム1回だけ計算しキャッシュ、warp 系は返り値でなく `out` スクラッチへ書き込む形へ統一。`|| {x:0,y:0}` は共有 `Object.freeze` 定数化。

**P2-2. `render()` が通常操作時に同期リフローを誘発し得る** — `app.js:12366` → `9146-9149`（`resizeCanvas`）※検証済み
毎フレーム `resizeCanvas()` が `window.innerWidth/innerHeight` を読む。これらはレイアウトが dirty な時に同期レイアウトを発生させ得るプロパティで、通常操作中は同一 tick 内の先行 DOM 書き込み（メーター幅・readout textContent）で dirty 化した直後に読むため、強制リフローの原因になりやすい（寸法更新用のデバウンス済み resize ハンドラは別に存在するので冗長）。なお OBS モードでも現コードはメーター/readout DOM 更新自体をスキップしていないが、UI が非表示化されるため影響は環境依存。
→ ビューポート寸法をキャッシュし、更新は resize/DPR 変化ハンドラ側のみ。`render()` では `ctx.setTransform` の基準リセットだけ残す。OBSモードではメーター/readout の DOM 書き込み自体をスキップ可。

**P2-3. 常時表示フローティング面への `backdrop-filter: blur()` 重畳** — `styles.css:394`（`.control-card`）, `1532`（`.live-bar`）, `249`, `723`, `1797`
全画面 `#stage` が毎フレーム再描画されるため、可視中は**毎フレーム背景ブラーの再合成**が走り GPU/合成コストが高い。
→ blur 半径を下げる（16→8等）、`.live-bar` だけでも撤廃、`prefers-reduced-motion` 時に無効化。

**P2-4. フラッドフィルがクリック毎にフルキャンバス `getImageData` を2回＋約13MB一時確保** — `app.js:5420, 5583`
snapshot 用と flood 用で `getImageData`（各4MB）を別々に取り、`Int32Array(1M)+Uint8Array(1M)` も毎回確保。
→ snapshot の `ImageData` を flood に渡して共有、queue は必要時のみ確保。

**P2-5. ソフトブラシがスタンプ毎に `createRadialGradient`＋`save/restore`** — `app.js:5661-5676`（1セグメント最大900回）
→ グラデ円をオフスクリーンに一度作り `drawImage` で貼る（色/半径不変ならキャッシュ）。

**P2-6. `putCharacterProfileRecord` が1書き込みで `getAll` を2回** — `app.js:3193, 3201`
autosave/複製/lastUsedAt 更新など全書き込み経路が通り、最大12件分（サムネ dataURL ＋ settingsPayload 込み）の structured-clone が2回走る。
→ 件数判定は `count()`+`getKey()`、書き込み後はキャッシュを in-memory マージ（`getAll` 再実行しない）。

**P2-7. autosave失敗時のリトライ欠如＋quota下の二次put** — `app.js:4160-4169`
IndexedDB 書き込み失敗時、dirty のままリトライをアームしない。さらに `patchCharacterProfile(...,{lastError})` の二次 put は、一次失敗が容量不足の場合に失敗が重なる可能性がある（ただし既存レコードへの小さな `lastError` 上書きなので、常に失敗するとは限らない）。
→ バックオフ付きで再アーム（回数上限付き）、`QuotaExceededError` 時は二次 put をスキップし「容量不足」を明示警告。

### セキュリティ・サプライチェーン

**P2-8. `verify_vendor_checksums.py` の閉包欠如** — `scripts/verify_vendor_checksums.py:23-48` ※検証済み
列挙されたファイルのハッシュのみ検証し、**未列挙ファイルの混入を検出しない** allowlist。vendor/ へ新規ファイルを紛れ込ませても CI が緑になる（パス脱出ガードは実装済みで良好）。
→ 検証後に各ディレクトリを走査し、`SHASUMS256.txt` 以外の全ファイルがマニフェストに載っていることを確認（現状ツリーは一致するので不変条件を固定できる）。

### アクセシビリティ

**P2-9. `<h1>` と `<main>` ランドマークが不在** — `index.html` 全体
見出しが各セクション `<h2>` から始まり、`#stage` ＋操作系がどのランドマークにも属さない（`styles.css:545` の `h1` ルールはデッドコード化）。
→ `.visually-hidden` の `<h1>ぷるぷるPNGTuber</h1>` を追加し、主要コンテンツを `<main>` で括る。

**P2-10. `.see-points` のハードコード色がダークで判読困難** — `styles.css:1773`（`color:#8a7355`）
ダーク時も同色のまま暗い半透明地に載る。
→ `var(--ink-soft)` 等テーマ変数化し、ダーク時に別値。

### 保守性・UX

**P2-11. ビューポートリサイズで手動ズーム/パンが毎回破棄** — `app.js:4751-4754`
手動ズーム中（`drawingAvatarAutoFit=false`）でも ResizeObserver 発火時に無条件で `fitDrawingAvatarViewport()`。
→ 手動ズーム時は fit せず、アンカー保持のクランプに留める。

### テストカバレッジの穴（横断）

**P2-12.** 重要ロジックに対する実行時テストの不足：
- **一般 `ui` id の実在検証がない** — `tests/test_project_static.py:982` の id 突合は `drawingAvatar` 系限定。約150個の一般 id はタイプミス/リネームで `null` 化しても**テストが緑のまま機能が静かに死ぬ**。→ 正規表現を全 `#id` へ拡張。
- **OBS API の happy-path 未検証** — `tests/test_project_static.py` は 403/400 の拒否のみ確認。全書き込み/読み取りが壊れても素通り。→ 正当な `Origin`+`Content-Type` で POST→200→GET で往復確認を1本追加。
- **item-layer 増幅（P1-1）/ autosave 競合・削除・quota（P2）/ 座標変換・flood・undo 予算 のテストが皆無** → `fake-indexeddb` ＋最小 canvas モックでシナリオテストを追加。
- `scripts/verify_vendor_checksums.py` に単体テストが無い（パス脱出/ハッシュ不一致/欠落の各分岐が未検証）。

---

## [P3] 将来的に / Nice-to-have

### パフォーマンス・正確性
- `app.js:8510, 8545` ハイライト signature をキャッシュヒット時も毎フレーム文字列生成 → 数値比較へ。
- `app.js:7892` `currentHairBundleRig` の既定リグ経路がキャッシュキーに顔メトリクス依存を含まず追従しない。
- `app.js:8941` `stopMicrophoneFromUi` 後も AudioContext が running のまま（`suspend()` 推奨、機能影響なし）。
- `app.js:9057` `loadImage` が decode 失敗を握り潰して壊れた画像で resolve → `naturalWidth===0` 検査後に resolve。
- `app.js:11310` `render()` の `drawItemLayers` がスロット毎に全件走査（O(6·N)）→ スロット別バケット化。
- `app.js:5576` フラッドフィルが取り込み PNG 画素を無視（仕様明示 or 合成へ塗る設計）。
- `app.js:3172-3182` `characterStorageEstimate` を毎書き込みで実行かつ警告は一度きり → スロットル＋再警告可へ。
- `app.js:2997, 3012, 6826, 6902` の OBS config/snapshot fetch にタイムアウト/中断なし（`/api/obs/input` の `app.js:6664` は `AbortController` 実装済み）→ `AbortController`＋3s timeout。
- `app.js:1151` `jsonByteSize` が計測のためだけに最大8MB Blob を確保 → `TextEncoder` 版へ統一。

### 保守性
- `app.js:14115/14125` `pointerup`/`pointercancel` の8行 dispatch チェーン重複 → 共通関数化。
- `app.js:6324` Ctrl+Z/Y を入力中判定より前に処理（将来テキスト欄追加で回帰）→ 判定順を入れ替え。
- `app.js:4885` 表情プレビュー再生成がパン/ズームでもスケジュール → 汚す操作のみ dirty。
- `app.js:5883` 他 固定レイヤー検索のインライン重複 → `drawingAvatarFixedLayer(key)` に統一。
- `app.js:4103/3184` autosave の2本 Promise チェーン＋複数フラグの不変条件が暗黙 → 明文化 or 一本化。

### フロント（HTML/CSS）
- `index.html:10-13` `Referrer-Policy` メタ未設定（`content="no-referrer"` 追加が無害）。`frame-ancestors` は meta CSP では無視されるため配信サーバの HTTP ヘッダ側で付与する旨をコメント化。
- `index.html:8` `theme-color:#0f1020` がライト/ダークどちらのパレットとも不一致。
- `index.html:38` `role="menu"` の子が `menuitem` でなく方向キー操作もない → role 除去 or 正しく実装。
- `index.html:606, 275-294` リセット/方向テストボタンへの `aria-pressed` 誤用 → アクションボタンから除去。
- `index.html:146-188` 疑似タブに `role="tablist/tab/tabpanel"` 未付与。
- `styles.css` の `font-weight:800` 多用だがバンドルは 500/700/900 のみ（意図した中間ウェイトではなく近いウェイトへスナップ/合成される）→ 700/900 へ寄せる。
- `index.html:16` `fonts.css`（約296KB）がレンダーブロッキング（`font-display:swap` は入済み）→ 主要面を `preload`。
- `styles.css:509-536, 545-549` 対応要素のないデッドルール群 → 削除。
- `styles.css:1181, 2151` 変数化体系に生の色リテラル混在（特に `.drawing-image-controls` はダーク上書き欠如）→ テーマ変数へ。

### その他（スクリプト・CI）
- `scripts/fetch_fonts.py:35, 61` ダウンロード元ホスト未固定・応答無制限 → `fonts.gstatic.com` 固定＋サイズ上限（開発専用でリスク低）。
- `scripts/run_local_server.py:105-126` keep-alive＋SSE が64スロットのセマフォを長時間占有、枯渇時にサイレントに接続 drop → 拒否時ログ。
- `.github/workflows/ci.yml:3-5` `concurrency` グループ無し＋`push`/`pull_request` 二重実行 → concurrency 追加（コストのみ）。
- `app.js:2388` `validatePngDataUrl` は base64 先頭シグネチャのみ検証（多層防御ありで実害小）。

---

## 検証して「問題なし」と判断した項目（誤検知の排除）

- **canvas null 時の初期化中断リスク → 棄却**: `app.js:466-471` に `if (!canvas || !ctx) { showStartupError(); return; }` の fail-fast ガードがあり、`bindUi()`/`bindCanvasInteractionControls` 到達時点で canvas は非 null 保証。`canvas.addEventListener`（`?.` なし）は安全で、初期化全体が壊れる経路は存在しない。
- **カメラ/マイク stream・AudioContext・rAF のリーク → 発見されず**: `faceTracker.stop()`（`cancelAnimationFrame`→`landmarker.close()`→`getTracks().stop()`→video remove）、`startMic` の先頭 `stopMic` ＋失敗時 catch 解放、`shutdownResources`（pagehide で AudioContext `close()`）が確実に実行され、二重取得ガードも担保。外部送信もなし。
- **ローカルサーバーのパス走査・LAN公開・API CSRF/DNS リバインド → 防御済み**: `127.0.0.1` 限定バインド、拡張子 allowlist ＋ `..`/バックスラッシュ/ドット接頭拒否、Host/Origin/Referer 検証、JSON 限定・サイズ上限・2s タイムアウト、CI のアクション SHA 固定＋`contents:read`＋`pull_request`（`_target` でない）。

---

## 全体の強み

1. **セキュリティ設計が優秀**: `sanitizeImportedJsonValue` の `FORBIDDEN_JSON_KEYS` 除去＋出力の全 `Object.create(null)` 化でプロトタイプ汚染を封じ、自前 ZIP(Store) パーサはエントリ数/展開合計サイズ/CRC32/STORE 限定/EOCD 境界/パス走査を網羅検証。CSP は `unsafe-inline`/`eval` を排して実測でも形骸化しておらず、外部オリジン依存ゼロで攻撃面が小さい。
2. **リソース管理と堅牢性**: メインループの try/catch/finally ＋2s スロットル＋確実な再スケジュール、rAF 単一化ガード、stream/AudioContext の確実な解放、髪バネ物理のサブステップ＋dt クランプによる発散防止。派生値の `motionFrameId` メモ化、IndexedDB の1トランザクション=1操作、autosave の revision スナップショット比較。
3. **テストが「本物」**: バイト操作した実 ZIP・稼働 HTTP サーバ・CSP のバイト一致比較を実行時に検証しており、静的サイト補助ツールとしては水準が高い。NaN/不正入力への正規化ガードも徹底。

---

## 推奨リファクタリング トップ3

1. **インポート経路の「上限を parse 段階で一元適用」＋大容量 base64 の Blob 経路化** — P1-1 のアイテム増幅 DoS と、大パッケージ読込時の同期 `atob`/`btoa` による UI フリーズ（P2級 UX）を同時に解消。`itemLayers` を parse 時に slice ＋累積バイト上限で守り、UI 表示は既存の `avatarImageBlobs`/`itemImageBlobs` + `createObjectURL` を優先して `u8ToPngDataUrl` 呼び出し自体を削減する。
2. **描画ホットパスのアロケーション削減** — warp 系（`deformerWarpPoint`/`faceWarpPoint`/`highlightWarpPoint`）を「返り値」から `out` スクラッチ書き込みへ統一し、25制御点グリッドをフレーム単位でキャッシュ、`resizeCanvas` の寸法読みもキャッシュ化。低スペック環境と OBS 高 fps でフレーム落ち/GC スパイクをまとめて改善（P2群の大半を吸収）。
3. **キャラ永続化ライフサイクルの堅牢化** — `activeCharacterId` の不整合ガード（P1-2）、quota リトライ/警告、`getAll` 二重呼び出しの削減、2本の Promise チェーンの一本化を行い、`fake-indexeddb` で autosave 競合・削除失敗・quota 経路のシナリオテストを整備（テスト穴も同時に埋める）。

> 補足: アクセシビリティは製品全体に効くため、`--muted` コントラスト（P1-3）と `<h1>`/`<main>` 追加（P2-9）を上記と並行して着手する価値があります。
