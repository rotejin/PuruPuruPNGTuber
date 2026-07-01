# 使い方 / Usage

PuruPuru PNGTuber は、通常のPNGTuber向け表情差分PNGに「前髪」と「後ろ髪」を追加して、髪揺れ・顔向き・口パク・まばたきを表現するローカルWebアプリです。

このリポジトリは、ユーザーがPNG素材を用意し、Codex / Claude Code などのAIコーディングエージェントに初期セットアップを依頼し、その後ブラウザ上で微調整する流れを想定しています。

PuruPuru PNGTuber is a local browser app for expressive PNGTuber avatars. Prepare aligned transparent PNGs, ask Codex or Claude Code to create the initial setup, then fine-tune the avatar in the browser.

## 1. 用意する画像

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
other.png     その他アイテム
```

重要:

- すべて透過PNGにしてください。
- 同じキャラ内のPNGは、同じキャンバスサイズ・同じ位置合わせにしてください。
- 顔、目、口、前髪、後ろ髪、ボディ、アクセサリの座標がズレていると、まばたき・口パク・顔向き・髪揺れ時にズレが目立ちます。
- 前髪と後ろ髪は、顔画像と同じキャンバス基準で書き出してください。
- 公開する場合、素材の利用権利を確認してください。

## 2. レイヤー構成

おおまかな描画順は次の通りです。

```text
1. キャラ背面アイテム
2. 後ろ髪
3. 顔・表情
4. 顔前アイテム
5. 前髪
6. 前髪前アイテム
7. 画面最前面アイテム
```

通常のPNGTuber表情差分に、前髪と後ろ髪を分けたPNGを追加することで、顔向きと髪揺れを別々に制御できます。

## 3. AIに初期セットアップを依頼する

キャラ追加時は、次のような依頼文を Codex / Claude Code などに渡す想定です。

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

AIに任せる主な作業:

- 素材ファイルとPNGサイズの確認
- `assets/<character-name>/` へのコピー
- ASCIIファイル名へのリネーム
- `default-settings.json` の作成
- 顔中心、目、鼻、口、顎、首支点の初期配置
- 髪束ラインの初期配置
- ボディ、リボン、ヘアアクセサリなどのアイテム初期配置
- 必要な場合のみ、キャラ固有の互換補正を追加
- 静的チェックと関連テスト

作業用の日本語フォルダや元素材フォルダは、公開リポジトリにはコミットしないでください。

## 4. ローカルで起動する

### Windows

```powershell
.\run_local_server.bat
```

または:

```powershell
python scripts\run_local_server.py
```

### macOS / Linux

```bash
chmod +x ./run_local_server.sh
./run_local_server.sh
```

### docker
```bash
docker compose up -d
```

または:

```bash
python3 scripts/run_local_server.py
```

起動後、サーバーが表示するローカルURLを開きます。

```text
http://127.0.0.1:8223/
```

通常利用では `file://` で `index.html` を直接開かないでください。ローカルサーバー経由の方が、ブラウザ権限、CSP、OBS連携が安定します。

## 5. 最初に確認すること

1. デモアバターまたは追加したキャラが表示される
2. `正面` で向きをリセットできる
3. `口パクデモ` で口が動く
4. `マイク開始` でマイク口パクが動く
5. `顔トラッキング開始` でカメラ追従が動く
6. 背景プリセットを切り替えられる。default is `クリーム (#FFF8EE)`
7. `.purupuru` ファイルを保存・読み込みできる

## 6. ユーザーが微調整すること

AIの初期設定は出発点です。最後はブラウザ上で確認してください。

- 顔を左右上下に向けた時に、顔パーツと髪の根元が離れないか
- 前髪がカツラのように浮いて見えないか
- 毛先だけが自然に遅れて揺れているか
- 口パク時に顎や口位置が破綻しないか
- ボディやアクセサリの位置、サイズ、前後関係が自然か
- OBS表示で見切れや透過の問題がないか

## 7. 髪と顔のキャラ固有補正

キャラによって、前髪の形、後ろ髪の面積、ボディアイテムの扱いは大きく異なります。たとえば、前髪が顔の上部を広く覆うキャラでは、前髪根元を顔/頭部に強く追従させないとカツラのように見えることがあります。

ただし、その補正を共通処理に入れると、既存キャラの前髪ワープが壊れる可能性があります。

推奨:

1. Best: `default-settings.json` やキャラ固有条件で、そのキャラだけに効かせる
2. Second-best: 明示的な互換フラグを追加し、対象キャラだけ有効化する
3. Not recommended: 1キャラのために共有の髪/顔ワープ処理を無条件に変更する

## 8. OBSで使う

OBSには、ローカルサーバー経由のOBS用URLをBrowser Sourceとして追加します。

基本方針:

- 通常画面でキャラを調整する
- OBS用URLをコピーする
- OBS Browser Sourceに貼る
- 透過背景を使う場合はOBS用の透過URLを使う

OBS表示で問題がある場合は、通常画面で現在のキャラをOBSへ反映し直してください。

## 9. `.purupuru` ファイル

`.purupuru` は、このアプリ用のキャラパッケージです。

含まれるもの:

- キャラPNG
- 調整値
- 顔中心、目、口、首支点、髪束ライン
- PNGアイテム
- OBS用設定

キャラ調整後は、バックアップとして `.purupuru` を保存してください。

## 10. よくあるトラブル

### 画像が表示されない

- PNGが壊れていないか確認してください。
- 必須ファイルが揃っているか確認してください。
- 同じキャラ内のPNGサイズが揃っているか確認してください。
- ブラウザコンソールに読み込みエラーがないか確認してください。

### まばたきや口パクでズレる

- 表情差分PNGの顔位置が揃っていない可能性があります。
- 全表情を同じキャンバス、同じ座標で書き出してください。

### 前髪がカツラのように見える

- 前髪の根元が顔/頭部に追従していない可能性があります。
- 髪束ラインの根元位置を確認してください。
- キャラ固有補正が必要な場合は、他キャラに影響しない条件分岐にしてください。

### マイクやカメラが使えない

- `file://` ではなくローカルサーバーURLで開いてください。
- ブラウザのマイク/カメラ権限を許可してください。
- 顔トラッキングはMediaPipeのCDN/model URLへアクセスできる必要があります。

### `.purupuru` の読み込みに失敗する

- このアプリで書き出した `.purupuru` を使ってください。
- ZIPの中身を手動編集しないでください。
- 埋め込みPNGが大きすぎたり壊れていないか確認してください。

## 11. 開発チェック

公開前やコード変更後は、最低限以下を実行します。

```bash
node --check app.js
node tests/js_runtime_checks.mjs
python -m py_compile scripts/run_local_server.py
python -m unittest tests.test_project_static
```
