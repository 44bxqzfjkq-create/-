/**
 * スプレッドシートの初期化。
 * CONFIG.STORES にある店舗ごとにシートを作成し、ヘッダー行を用意する。
 * すでにあるシートは壊さない（何度実行しても安全）。
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

  const created: string[] = [];
  const skipped: string[] = [];

  getAllStoreNames().forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
    } else {
      skipped.push(name);
    }

    // ヘッダーが無ければ用意する
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(CONFIG.HEADER);
      sheet
        .getRange(1, 1, 1, CONFIG.HEADER.length)
        .setFontWeight("bold")
        .setBackground("#f1f3f4");
      sheet.setFrozenRows(1);
      // 金額列を右寄せ・カンマ区切りに
      const amountCol = CONFIG.HEADER.indexOf("金額") + 1;
      if (amountCol > 0) {
        sheet.getRange(2, amountCol, sheet.getMaxRows() - 1, 1).setNumberFormat("#,##0");
      }
    }
  });

  // 初期状態の「シート1」が空なら片付ける（任意）
  const defaultSheet = ss.getSheetByName("シート1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log(
    "初期化完了。作成: [%s] / 既存: [%s]",
    created.join(", ") || "なし",
    skipped.join(", ") || "なし"
  );
}
