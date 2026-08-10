/**
 * 受付フォームのWebアプリ本体。
 * - doGet: フォームHTMLを返す（客が開くページ）
 * - submitOrder: フォームから呼ばれ、受付内容をスプレッドシートに記録する
 *   （支払い写真があればドライブに保存し、リンクを記録）
 *
 * ※認証情報（パスワード等）は受け取らない。連絡先・希望内容・支払い写真のみ。
 */

/** Webアプリのエントリポイント。フォームHTMLを返す。 */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  const template = HtmlService.createTemplateFromFile("form");
  template.menusJson = JSON.stringify(CONFIG.MENUS);
  template.appTitle = CONFIG.APP_TITLE;
  template.requirePhoto = CONFIG.REQUIRE_PHOTO ? "true" : "false";

  return template
    .evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 添付画像（フォームから base64 のデータURLで届く） */
interface ImageInput {
  dataUrl: string; // 例: "data:image/jpeg;base64,...."
  name: string; // 元ファイル名（任意）
}

/** フォーム送信の入力型 */
interface OrderInput {
  menu: string;
  qty: number | string;
  amount: number | string;
  contact: string;
  note: string;
  image?: ImageInput | null;
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

  const hasImage = !!(input.image && input.image.dataUrl);
  if (CONFIG.REQUIRE_PHOTO && !hasImage) {
    return { ok: false, message: "支払いの写真を添付してください。" };
  }

  // ---- 採番 ----
  const now = new Date();
  const receiptNo = generateReceiptNo(sheet, now);
  const timestamp = Utilities.formatDate(
    now,
    CONFIG.TIMEZONE,
    "yyyy/MM/dd HH:mm:ss"
  );

  // ---- 支払い写真を保存（あれば） ----
  let photoUrl = "";
  if (hasImage) {
    try {
      photoUrl = savePhotoToDrive(input.image as ImageInput, receiptNo);
    } catch (e) {
      return {
        ok: false,
        message:
          "写真の保存に失敗しました。時間をおいて再度お試しください。（" +
          (e && (e as Error).message ? (e as Error).message : e) +
          "）",
      };
    }
  }

  // ---- HEADER の並びに合わせて1行を組み立てて追記 ----
  const record: { [col: string]: string | number } = {
    受付日時: timestamp,
    受付番号: receiptNo,
    希望メニュー: menu,
    数量: qty,
    金額: amount,
    連絡先: contact,
    備考: note,
    支払い写真: photoUrl,
    ステータス: CONFIG.DEFAULT_STATUS,
  };
  const row = CONFIG.HEADER.map((col) =>
    record[col] !== undefined ? record[col] : ""
  );
  sheet.appendRow(row);

  return { ok: true, receiptNo: receiptNo };
}

/**
 * 支払い写真（データURL）をGoogleドライブに保存し、閲覧URLを返す。
 * 保存先フォルダは CONFIG.PHOTO_FOLDER_NAME（無ければ作成）。
 */
function savePhotoToDrive(image: ImageInput, receiptNo: string): string {
  const match = /^data:([^;]+);base64,(.+)$/.exec(image.dataUrl || "");
  if (!match) {
    throw new Error("画像データの形式が不正です。");
  }
  const mimeType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);

  // 拡張子
  const ext = mimeType.indexOf("png") >= 0 ? "png" : "jpg";
  const filename = receiptNo + "_payment." + ext;

  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const folder = getOrCreatePhotoFolder();
  const file = folder.createFile(blob);
  return file.getUrl();
}

/** 支払い写真フォルダを取得（無ければ作成）。 */
function getOrCreatePhotoFolder(): GoogleAppsScript.Drive.Folder {
  const name = CONFIG.PHOTO_FOLDER_NAME;
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return DriveApp.createFolder(name);
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
