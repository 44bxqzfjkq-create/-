/**
 * スプレッドシートの初期化。
 * 受付シートを作成し、ヘッダー行を用意する。
 * すでにあれば壊さない（何度実行しても安全）。
 *
 * 使い方: Apps Scriptエディタで関数 `initSpreadsheet` を選んで実行する。
 */
function initSpreadsheet(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      "アクティブなスプレッドシートがありません。スプレッドシートに紐づいたスクリプトとして実行してください。"
    );
  }

  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const isNew = !sheet;
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  // ヘッダーが無ければ用意する
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(CONFIG.HEADER);
    sheet
      .getRange(1, 1, 1, CONFIG.HEADER.length)
      .setFontWeight("bold")
      .setBackground("#f1f3f4");
    sheet.setFrozenRows(1);

    // 金額列をカンマ区切りに
    const amountCol = CONFIG.HEADER.indexOf("金額") + 1;
    if (amountCol > 0) {
      sheet
        .getRange(2, amountCol, sheet.getMaxRows() - 1, 1)
        .setNumberFormat("#,##0");
    }
  }

  // 初期状態の空シート「シート1 / Sheet1」を片付ける（任意）
  const defaultSheet =
    ss.getSheetByName("シート1") || ss.getSheetByName("Sheet1");
  if (
    defaultSheet &&
    ss.getSheets().length > 1 &&
    defaultSheet.getLastRow() === 0
  ) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log(
    "初期化完了。受付シート「%s」を%sしました。",
    CONFIG.SHEET_NAME,
    isNew ? "作成" : "確認（既存）"
  );
}
