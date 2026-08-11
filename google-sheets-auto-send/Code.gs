/**
 * 依頼リスト 自動送信スクリプト（Google スプレッドシート用）
 * ------------------------------------------------------------------
 * 特徴：
 *   - 列の「位置」ではなく「見出し名」で項目を探すので、列の並び順が違っても、
 *     他の列が混ざっていても、そのまま動きます。
 *   - 既存の見出しやデータは壊しません（不足している「送信」列だけ追加します）。
 *
 * 使い方の概要：
 *   1. スプレッドシートの「拡張機能 > Apps Script」にこのコードを貼り付ける
 *   2. 下の CONFIG に Webhook URL と、あなたのシート名を設定する
 *   3. スプレッドシート上のメニュー「依頼管理 > 初期設定」を実行する
 *   4. 「送信」列のチェックを入れると、その行を Webhook へ送信し、
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

  // 依頼を管理するシート（タブ）の名前。あなたのシート名に合わせてください
  SHEET_NAME: 'シート1',

  // 見出し（項目名）がある行。通常は1行目
  HEADER_ROW: 1,

  // 送信用チェックボックスの列の「見出し名」。
  // この見出しの列が無ければ、初期設定で右端に自動追加します。
  SEND_HEADER: '送信',

  // 送信メッセージに含める項目（見出し名）。ここに並べた順で本文に出ます。
  // 見出し名は、あなたのシートの見出しと「完全に一致」させてください。
  FIELDS: ['受付番号', '希望メニュー', '金額', '連絡先', '備考', '写真'],

  // 金額としてフォーマット（¥ と桁区切り）する項目の見出し名。無ければ '' に。
  MONEY_HEADER: '金額',

  // 初期設定でチェックボックスを敷く行数の上限
  CHECKBOX_ROWS: 1000,
};

// ==================================================================
// メニュー
// ==================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('依頼管理')
    .addItem('初期設定（送信列＋自動送信ON）', 'setupSheet')
    .addItem('選択した行を今すぐ送信', 'sendSelectedRow')
    .addSeparator()
    .addItem('送信テスト（Web接続の確認）', 'testWebhook')
    .addToUi();
}

// ==================================================================
// 初期設定：送信列（チェックボックス）とトリガーを用意（非破壊）
// ==================================================================
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    ss.toast('「' + CONFIG.SHEET_NAME + '」というシートが見つかりません。CONFIG.SHEET_NAME を実際のシート名に合わせてください。', 'エラー', 8);
    return;
  }

  const map = getHeaderMap(sheet);

  // 送信先項目の見出しがちゃんと存在するかチェック
  const missing = CONFIG.FIELDS.filter(function (name) { return !map[name]; });
  if (missing.length > 0) {
    ss.toast('見出しが見つかりません：' + missing.join(', ') + '\nCONFIG.FIELDS の名前をシートの見出しと一致させてください。', '注意', 10);
    // 続行はする（見つかった項目だけ送る運用も可能）
  }

  // 「送信」列が無ければ右端に追加
  let sendCol = map[CONFIG.SEND_HEADER];
  if (!sendCol) {
    sendCol = sheet.getLastColumn() + 1;
    sheet.getRange(CONFIG.HEADER_ROW, sendCol)
      .setValue(CONFIG.SEND_HEADER)
      .setFontWeight('bold')
      .setBackground('#f1f3f4');
  }

  // 送信列にチェックボックスを敷く（既存行数に合わせて安全にクランプ）
  const startRow = CONFIG.HEADER_ROW + 1;
  const rowsAvail = sheet.getMaxRows() - startRow + 1;
  const n = Math.min(CONFIG.CHECKBOX_ROWS, rowsAvail);
  if (n > 0) {
    sheet.getRange(startRow, sendCol, n, 1).insertCheckboxes();
  }

  installTrigger();

  ss.toast('初期設定が完了しました。「' + CONFIG.SEND_HEADER + '」列にチェックを入れると自動送信されます。', 'セットアップ完了', 6);
}

// 自動送信用のインストール型 onEdit トリガーを（重複なく）作成
function installTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (range.getRow() <= CONFIG.HEADER_ROW) return;

  const map = getHeaderMap(sheet);
  const sendCol = map[CONFIG.SEND_HEADER];
  if (!sendCol) return;                       // 送信列がまだ無い
  if (range.getColumn() !== sendCol) return;  // 送信列以外の編集は無視

  // チェックが「ON（TRUE）」になったときだけ処理
  if (String(e.value) !== 'TRUE') return;

  processRow(sheet, range.getRow(), map);
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
  processRow(sheet, row, getHeaderMap(sheet));
}

// 1行分を送信して、成功したら削除
function processRow(sheet, row, map) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  map = map || getHeaderMap(sheet);

  // 送信対象の見出し → 値 を集める
  const parts = [];
  let hasData = false;
  CONFIG.FIELDS.forEach(function (name) {
    const col = map[name];
    let raw = col ? sheet.getRange(row, col).getValue() : '';
    if (raw !== '' && raw !== null && raw !== undefined) hasData = true;
    const display = (name === CONFIG.MONEY_HEADER) ? formatMoney(raw) : safe(raw);
    parts.push(name + '：' + display);
  });

  // 空行なら何もしない
  if (!hasData) {
    const sendCol = map[CONFIG.SEND_HEADER];
    if (sendCol) sheet.getRange(row, sendCol).setValue(false);
    ss.toast('空の行のため送信をスキップしました。', '注意', 4);
    return;
  }

  const message = '🆕 新しい依頼\n' + parts.join('\n');

  let ok = false;
  let errMsg = '';
  try {
    ok = postToWebhook(message);
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }

  if (ok) {
    sheet.deleteRow(row);
    ss.toast('依頼完了：送信して行を削除しました。', '送信完了', 4);
  } else {
    // 失敗時はチェックを外して行は残す（消えないので安全）
    const sendCol = map[CONFIG.SEND_HEADER];
    if (sendCol) sheet.getRange(row, sendCol).setValue(false);
    ss.toast('送信に失敗しました。Webhook設定を確認してください。' + (errMsg ? '（' + errMsg + '）' : ''), 'エラー', 8);
  }
}

// ==================================================================
// ヘルパー
// ==================================================================

// 見出し行を読んで {見出し名: 列番号(1始まり)} のマップを返す
function getHeaderMap(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sheet.getRange(CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach(function (h, i) {
    const name = String(h).trim();
    if (name) map[name] = i + 1;
  });
  return map;
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
    payload = { content: text }; // Discord
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
