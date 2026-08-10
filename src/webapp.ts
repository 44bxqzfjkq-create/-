/**
 * 受付フォームのWebアプリ本体。
 * - doGet: フォームHTMLを返す（客が開くページ）
 * - submitOrder: フォームから呼ばれ、受付内容をスプレッドシートに記録する
 *
 * ※認証情報（パスワード等）は受け取らない。連絡先と希望内容のみ。
 */

/** Webアプリのエントリポイント。フォームHTMLを返す。 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("form");
  // クライアント側へ渡す値
  template.menusJson = JSON.stringify(CONFIG.MENUS);
  template.appTitle = CONFIG.APP_TITLE;

  return template
    .evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** フォーム送信の入力型 */
interface OrderInput {
  menu: string;
  qty: number | string;
  amount: number | string;
  contact: string;
  note: string;
}

/** 送信結果の返却型 */
interface OrderResult {
  ok: boolean;
  receiptNo?: string;
  message?: string;
}

/**
 * フォームから呼ばれる記録処理。
 * google.script.run.submitOrder(input) の形で呼び出される。
 */
function submitOrder(input: OrderInput): OrderResult {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    return {
      ok: false,
      message: "受付シートがありません。先に initSpreadsheet を実行してください。",
    };
  }

  // ---- 入力チェック（サーバー側でも必ず検証する） ----
  const menu = String(input.menu || "").trim();
  const contact = String(input.contact || "").trim();
  const note = String(input.note || "").trim();
  const qty = Number(input.qty);
  const amount = Number(input.amount);

  if (!menu || getMenuNames().indexOf(menu) < 0) {
    return { ok: false, message: "希望メニューを選んでください。" };
  }
  if (!contact) {
    return { ok: false, message: "連絡先を入力してください。" };
  }
  if (!(qty > 0)) {
    return { ok: false, message: "数量は1以上の数字で入力してください。" };
  }
  if (!(amount >= 0) || isNaN(amount)) {
    return { ok: false, message: "金額を正しく入力してください。" };
  }

  // ---- 記録 ----
  const now = new Date();
  const receiptNo = generateReceiptNo(sheet, now);
  const timestamp = Utilities.formatDate(
    now,
    CONFIG.TIMEZONE,
    "yyyy/MM/dd HH:mm:ss"
  );

  // HEADER の並びに合わせて1行追加
  sheet.appendRow([
    timestamp, // 受付日時
    receiptNo, // 受付番号
    menu, // 希望メニュー
    qty, // 数量
    amount, // 金額
    contact, // 連絡先
    note, // 備考
    CONFIG.DEFAULT_STATUS, // ステータス
  ]);

  return { ok: true, receiptNo: receiptNo };
}

/**
 * 受付番号を採番する。形式: <PREFIX>-YYYYMMDD-NNN（当日連番）。
 */
function generateReceiptNo(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  now: Date
): string {
  const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd");
  const prefix = CONFIG.RECEIPT_PREFIX + "-" + dateStr + "-";

  // 受付番号列（HEADERの位置から算出）
  const noCol = CONFIG.HEADER.indexOf("受付番号") + 1;
  const lastRow = sheet.getLastRow();

  let count = 0;
  if (lastRow >= 2 && noCol > 0) {
    const values = sheet.getRange(2, noCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0]).indexOf(prefix) === 0) {
        count++;
      }
    }
  }

  const seq = ("00" + (count + 1)).slice(-3);
  return prefix + seq;
}
