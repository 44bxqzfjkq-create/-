# LINE売上管理システム (GAS + clasp + TypeScript)

LINE公式アカウントに番号を送ると店舗別の売上をスプレッドシートに記録し、
リッチメニューからダッシュボード（推移グラフ）を開けるシステムです。

## 全体像（作る順番）

段階ごとに動作確認しながら進めます。

1. **clasp環境のセットアップ + スプレッドシート初期化** ← いまここ
2. Webhook受信とオウム返し（疎通確認）
3. 番号 → 案内 → 記録のフロー
4. ダッシュボード（doGet + Chart.js）
5. リッチメニュー登録

---

## ステップ1: 環境構築とスプレッドシート初期化

### 1-1. 必要なもの

- Node.js 18以上（`node -v` で確認）
- Googleアカウント

### 1-2. 依存パッケージのインストール

```bash
npm install
```

`clasp` / TypeScript の型定義がローカルに入ります。

### 1-3. Google側で clasp を使えるようにする

初回だけ以下を実施します。

1. [Apps Script API を有効化](https://script.google.com/home/usersettings) → 「Google Apps Script API」をオンにする
2. claspにログイン

```bash
npx clasp login
```

ブラウザが開くので、対象のGoogleアカウントで許可してください。

### 1-4. スプレッドシート付きのGASプロジェクトを作成

このシステムは「スプレッドシートに紐づいたスクリプト（コンテナバインド）」として動かします。
以下のコマンドで、スプレッドシートとスクリプトが同時に作られます。

```bash
npx clasp create --type sheets --title "LINE売上管理" --rootDir src
```

- 実行すると `.clasp.json` が生成されます（`scriptId` が入る／git管理外）
- `.clasp.json` の中身が `{"scriptId":"...","rootDir":"src"}` になっていることを確認してください
  （`rootDir` が入っていなければ `.clasp.json.example` を参考に追記）

> `.clasp.json` は個人ごとのIDを含むためコミットしません（`.gitignore` 済み）。

### 1-5. コードをアップロード（push）

```bash
npm run push
# 中身: clasp push
```

`src/` 配下の `.ts` と `appsscript.json` がGASへ送られます。
（clasp が TypeScript を自動でトランスパイルします）

### 1-6. スプレッドシートを初期化

```bash
npm run open   # ブラウザでスクリプトエディタが開く
```

スクリプトエディタで:

1. 上部の関数選択プルダウンで **`initSpreadsheet`** を選ぶ
2. **実行** をクリック
3. 初回は権限の承認ダイアログが出るので許可する

---

## ステップ1の動作確認

以下を満たしていればOKです。

- [ ] `npm install` がエラーなく完了する
- [ ] `npx clasp create ...` で `.clasp.json` が生成される
- [ ] `npm run push` が成功する（`Pushed N files.` と表示）
- [ ] `initSpreadsheet` 実行後、スプレッドシートに **A店 / B店 / C店** の3シートができる
- [ ] 各シートの1行目が **日時 / 店舗名 / 金額** になっている

スプレッドシート本体は `npx clasp open --addon` ではなく、
スクリプトエディタ左上の「〈 」やドライブから開けます。
（`clasp create --type sheets` の出力に Spreadsheet のURLも表示されます）

確認できたら教えてください。**ステップ2（Webhookのオウム返し）** に進みます。

---

## 設定の変更ポイント

店舗を増やす／変えるときは `src/config.ts` の `STORES` を編集して、
`initSpreadsheet` を再実行するだけです（既存シートは壊しません）。

```ts
STORES: {
  "1": "A店",
  "2": "B店",
  "3": "C店",
  "4": "D店", // ← 追加してもOK
},
```

## ディレクトリ構成

```
.
├── package.json         # clasp / TypeScript
├── tsconfig.json
├── .claspignore         # push対象の制御
├── .clasp.json.example  # .clasp.json の雛形（実体はgit管理外）
└── src/
    ├── appsscript.json  # GASマニフェスト（タイムゾーン/Webアプリ設定）
    ├── config.ts        # 店舗マッピングなどの設定オブジェクト
    └── setup.ts         # initSpreadsheet（シート初期化）
```
