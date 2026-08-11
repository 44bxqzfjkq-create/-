/**
 * 依頼リスト 自動送信スクリプト（Google スプレッドシート用）
 * ------------------------------------------------------------------
 * 使い方の概要：
 *   1. スプレッドシートの「拡張機能 > Apps Script」にこのコードを貼り付ける
 *   2. 下の CONFIG に Webhook URL を設定する
 *   3. スプレッドシート上のメニュー「依頼管理 > 初期設定」を実行する
 *   4. 「送信」列（G列）のチェックを入れると、その行を Webhook へ送信し、
 *      成功したら行を自動で削除して次の依頼が繰り上がる
 *
 * 詳しい手順は README.md を参照してください。
 */

// ==================================================================
// 設定（ここだけ書き換えればOK）
// ==================================================================
const CONFIG = {
  // Discord または Slack の Webhook URL をここに貼り付けてください
  WEBHOOK_URL: 'ここにWebhookのURLを貼り付け',

  // 'discord' か 'slack' を指定
  WEBHOOK_TYPE: 'discord',

  // 依頼を管理するシート名
  SHEET_NAME: '依頼リスト',

  // ヘッダー（項目名）がある行。通常は1行目
  HEADER_ROW: 1,

  // 「送信」チェックボックスの列番号（A=1, B=2, ... G=7）
  // 受付番号A / 希望メニューB / 金額C / 連絡先D / 備考E / 写真F / 送信G
  SEND_COLUMN: 7,

  // チェックボックスを敷いておく行数（初期設定で使用）
  CHECKBOX_ROWS: 1000,
};

// 項目名（初期設定でヘッダーとして書き込む）
const HEADERS = ['受付番号', '希望メニュー', '金額', '連絡先', '備考', '写真', '送信'];

// ==================================================================
// メニュー
// ==================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('依頼管理')
    .addItem('初期設定（シート作成＋自動送信ON）', 'setupSheet')
    .addItem('選択した行を今すぐ送信', 'sendSelectedRow')
    .addSeparator()
    .addItem('送信テスト（Web接続の確認）', 'testWebhook')
    .addToUi();
}

// ==================================================================
// 初期設定：ヘッダー・チェックボックス・トリガーをまとめて用意
// ==================================================================
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  // ヘッダー行
  sheet
    .getRange(CONFIG.HEADER_ROW, 1, 1, HEADERS.length)
    .setValues([HEADERS])
    .setFontWeight('bold')
    .setBackground('#f1f3f4');
  sheet.setFrozenRows(CONFIG.HEADER_ROW);

  // 送信列にチェックボックスを敷く
  const startRow = CONFIG.HEADER_ROW + 1;
  sheet
    .getRange(startRow, CONFIG.SEND_COLUMN, CONFIG.CHECKBOX_ROWS, 1)
    .insertCheckboxes();

  // 列幅をざっくり整える
  sheet.setColumnWidth(1, 100); // 受付番号
  sheet.setColumnWidth(2, 160); // 希望メニュー
  sheet.setColumnWidth(3, 100); // 金額
  sheet.setColumnWidth(4, 160); // 連絡先
  sheet.setColumnWidth(5, 220); // 備考
  sheet.setColumnWidth(6, 220); // 写真
  sheet.setColumnWidth(7, 70);  // 送信

  installTrigger();

  ss.toast('初期設定が完了しました。G列の「送信」にチェックを入れると自動送信されます。', 'セットアップ完了', 6);
}

// 自動送信用のインストール型 onEdit トリガーを（重複なく）作成
function installTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 既存の同名トリガーを削除してから作り直す（重複防止）
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditInstallable') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
}

// ==================================================================
// 自動送信の本体（チェックが入った瞬間に呼ばれる）
// ==================================================================
function onEditInstallable(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();

  // 対象シート・送信列・データ行のみ反応
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (range.getColumn() !== CONFIG.SEND_COLUMN) return;
  if (range.getRow() <= CONFIG.HEADER_ROW) return;

  // チェックが「ON（TRUE）」になったときだけ処理
  if (String(e.value) !== 'TRUE') return;

  processRow(sheet, range.getRow());
}

// メニューから「選択した行を今すぐ送信」
function sendSelectedRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) {
    ss.toast('「' + CONFIG.SHEET_NAME + '」シートで実行してください。', '注意', 5);
    return;
  }
  const row = sheet.getActiveCell().getRow();
  if (row <= CONFIG.HEADER_ROW) {
    ss.toast('データ行を選択してください。', '注意', 5);
    return;
  }
  processRow(sheet, row);
}

// 1行分を送信して、成功したら削除
function processRow(sheet, row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataCols = CONFIG.SEND_COLUMN - 1; // 送信列より前がデータ（A〜F）
  const values = sheet.getRange(row, 1, 1, dataCols).getValues()[0];

  const record = {
    uketsuke: values[0], // 受付番号
    menu: values[1],     // 希望メニュー
    kingaku: values[2],  // 金額
    renraku: values[3],  // 連絡先
    biko: values[4],     // 備考
    shashin: values[5],  // 写真（URL）
  };

  // 空行なら何もしない（受付番号・希望メニューの両方が空）
  if (record.uketsuke === '' && record.menu === '') {
    sheet.getRange(row, CONFIG.SEND_COLUMN).setValue(false);
    ss.toast('空の行のため送信をスキップしました。', '注意', 4);
    return;
  }

  const message = buildMessage(record);

  let ok = false;
  let errMsg = '';
  try {
    ok = postToWebhook(message);
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }

  if (ok) {
    sheet.deleteRow(row);
    ss.toast('依頼完了：受付番号「' + record.uketsuke + '」を送信して削除しました。', '送信完了', 4);
  } else {
    // 失敗時はチェックを外して行は残す（消えないので安全）
    sheet.getRange(row, CONFIG.SEND_COLUMN).setValue(false);
    ss.toast('送信に失敗しました。Webhook設定を確認してください。' + (errMsg ? '（' + errMsg + '）' : ''), 'エラー', 8);
  }
}

// ==================================================================
// メッセージ組み立て
// ==================================================================
function buildMessage(r) {
  const kingaku = formatMoney(r.kingaku);
  const lines = [
    '🆕 新しい依頼',
    '受付番号：' + safe(r.uketsuke),
    '希望メニュー：' + safe(r.menu),
    '金額：' + kingaku,
    '連絡先：' + safe(r.renraku),
    '備考：' + safe(r.biko),
    '写真：' + safe(r.shashin),
  ];
  return lines.join('\n');
}

function formatMoney(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  if (typeof v === 'number') return '¥' + v.toLocaleString('ja-JP');
  return String(v);
}

function safe(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  return String(v);
}

// ==================================================================
// Webhook 送信（Discord / Slack 両対応）
// ==================================================================
function postToWebhook(text) {
  const url = CONFIG.WEBHOOK_URL;
  if (!url || url.indexOf('http') !== 0) {
    throw new Error('WEBHOOK_URL が未設定です');
  }

  let payload;
  if (CONFIG.WEBHOOK_TYPE === 'slack') {
    payload = { text: text };
  } else {
    // Discord
    payload = { content: text };
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  return code >= 200 && code < 300;
}

// 接続テスト（メニューから実行）
function testWebhook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ok = false;
  let errMsg = '';
  try {
    ok = postToWebhook('✅ 接続テスト：依頼リストの自動送信は正常に動作しています。');
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }
  if (ok) {
    ss.toast('テスト送信に成功しました。Webhook側を確認してください。', 'テストOK', 5);
  } else {
    ss.toast('テスト送信に失敗しました。' + (errMsg ? '（' + errMsg + '）' : ''), 'テスト失敗', 8);
  }
}
