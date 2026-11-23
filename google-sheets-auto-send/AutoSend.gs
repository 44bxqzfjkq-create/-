/**
 * 依頼リスト 自動送信（既存コードと共存できる版）
 * ==================================================================
 * ★この版の狙い★
 *   すでに別のコードが入っている Apps Script プロジェクトに、
 *   「新しいファイルを1つ足すだけ」で共存できるようにしたもの。
 *   - 変数名・関数名をすべて "SOUSHIN_" / "soushin" で始まるユニーク名にして
 *     既存コードとの衝突（CONFIG などの重複宣言エラー）を回避。
 *   - メニューは onOpen を奪わず、インストール型 onOpen トリガーで追加。
 *   → だから既存の onOpen / onEdit / CONFIG はそのままでOK。
 *
 * ★導入手順★
 *   1. Apps Script で「＋ > スクリプト」から新しいファイルを作り、
 *      この中身をまるごと貼り付ける（既存ファイルは触らない）。
 *   2. 下の SOUSHIN_CONFIG を設定する（Webhook URL とシート名など）。
 *   3. エディタ上部の関数選択で「soushinSetup」を選び、▶実行（初回だけ）。
 *      権限確認が出たら許可する。
 *   4. スプレッドシートを再読み込みすると「依頼管理」メニューが出る。
 *      「送信」列にチェックを入れると自動送信＆行削除される。
 */

// ==================================================================
// 設定（ここだけ書き換える）
// ==================================================================
const SOUSHIN_CONFIG = {
  WEBHOOK_URL: 'ここにWebhookのURLを貼り付け',
  WEBHOOK_TYPE: 'discord',        // 'discord' か 'slack'
  SHEET_NAME: 'シート1',           // あなたのシート（タブ）名に合わせる
  HEADER_ROW: 1,                  // 見出し行
  SEND_HEADER: '送信',            // 送信チェックボックス列の見出し（無ければ自動追加）
  FIELDS: ['受付番号', '希望メニュー', '金額', '連絡先', '備考', '写真'], // 送る項目（見出し名）
  MONEY_HEADER: '金額',           // 金額として整形する項目（無ければ ''）
  CHECKBOX_ROWS: 1000,
};

// ==================================================================
// メニュー（インストール型 onOpen トリガーから呼ばれる）
//   ※ 既存の onOpen を奪わないため、名前を soushinOnOpen にしている
// ==================================================================
function soushinOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('依頼管理')
    .addItem('初期設定（送信列＋自動送信ON）', 'soushinSetup')
    .addItem('選択した行を今すぐ送信', 'soushinSendSelectedRow')
    .addSeparator()
    .addItem('送信テスト（Web接続の確認）', 'soushinTestWebhook')
    .addToUi();
}

// ==================================================================
// 初期設定：送信列（チェックボックス）＋トリガー2種を用意（非破壊）
//   ※ 初回はエディタから手動で1回実行する
// ==================================================================
function soushinSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SOUSHIN_CONFIG.SHEET_NAME);
  if (!sheet) {
    ss.toast('「' + SOUSHIN_CONFIG.SHEET_NAME + '」というシートが見つかりません。SOUSHIN_CONFIG.SHEET_NAME を実際のシート名に合わせてください。', 'エラー', 8);
    return;
  }

  const map = soushinGetHeaderMap(sheet);

  const missing = SOUSHIN_CONFIG.FIELDS.filter(function (name) { return !map[name]; });
  if (missing.length > 0) {
    ss.toast('見出しが見つかりません：' + missing.join(', ') + '\nSOUSHIN_CONFIG.FIELDS をシートの見出しと一致させてください。', '注意', 10);
  }

  // 「送信」列が無ければ右端に追加
  let sendCol = map[SOUSHIN_CONFIG.SEND_HEADER];
  if (!sendCol) {
    sendCol = sheet.getLastColumn() + 1;
    sheet.getRange(SOUSHIN_CONFIG.HEADER_ROW, sendCol)
      .setValue(SOUSHIN_CONFIG.SEND_HEADER)
      .setFontWeight('bold')
      .setBackground('#f1f3f4');
  }

  // チェックボックスを敷く
  const startRow = SOUSHIN_CONFIG.HEADER_ROW + 1;
  const rowsAvail = sheet.getMaxRows() - startRow + 1;
  const n = Math.min(SOUSHIN_CONFIG.CHECKBOX_ROWS, rowsAvail);
  if (n > 0) {
    sheet.getRange(startRow, sendCol, n, 1).insertCheckboxes();
  }

  soushinInstallTriggers();

  ss.toast('初期設定が完了しました。ページを再読み込みするとメニューが出ます。', 'セットアップ完了', 6);
}

// インストール型トリガー（onEdit と onOpen）を重複なく作成
function soushinInstallTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'soushinOnEdit' || fn === 'soushinOnOpen') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('soushinOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('soushinOnOpen').forSpreadsheet(ss).onOpen().create();
}

// ==================================================================
// 自動送信の本体（チェックが入った瞬間に呼ばれる）
// ==================================================================
function soushinOnEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();

  if (sheet.getName() !== SOUSHIN_CONFIG.SHEET_NAME) return;
  if (range.getRow() <= SOUSHIN_CONFIG.HEADER_ROW) return;

  const map = soushinGetHeaderMap(sheet);
  const sendCol = map[SOUSHIN_CONFIG.SEND_HEADER];
  if (!sendCol) return;
  if (range.getColumn() !== sendCol) return;

  if (String(e.value) !== 'TRUE') return;

  soushinProcessRow(sheet, range.getRow(), map);
}

// メニューから「選択した行を今すぐ送信」
function soushinSendSelectedRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== SOUSHIN_CONFIG.SHEET_NAME) {
    ss.toast('「' + SOUSHIN_CONFIG.SHEET_NAME + '」シートで実行してください。', '注意', 5);
    return;
  }
  const row = sheet.getActiveCell().getRow();
  if (row <= SOUSHIN_CONFIG.HEADER_ROW) {
    ss.toast('データ行を選択してください。', '注意', 5);
    return;
  }
  soushinProcessRow(sheet, row, soushinGetHeaderMap(sheet));
}

// 1行分を送信して、成功したら削除
function soushinProcessRow(sheet, row, map) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  map = map || soushinGetHeaderMap(sheet);

  const parts = [];
  let hasData = false;
  SOUSHIN_CONFIG.FIELDS.forEach(function (name) {
    const col = map[name];
    let raw = col ? sheet.getRange(row, col).getValue() : '';
    if (raw !== '' && raw !== null && raw !== undefined) hasData = true;
    const display = (name === SOUSHIN_CONFIG.MONEY_HEADER) ? soushinFormatMoney(raw) : soushinSafe(raw);
    parts.push(name + '：' + display);
  });

  if (!hasData) {
    const sendCol = map[SOUSHIN_CONFIG.SEND_HEADER];
    if (sendCol) sheet.getRange(row, sendCol).setValue(false);
    ss.toast('空の行のため送信をスキップしました。', '注意', 4);
    return;
  }

  const message = '🆕 新しい依頼\n' + parts.join('\n');

  let ok = false;
  let errMsg = '';
  try {
    ok = soushinPostToWebhook(message);
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }

  if (ok) {
    sheet.deleteRow(row);
    ss.toast('依頼完了：送信して行を削除しました。', '送信完了', 4);
  } else {
    const sendCol = map[SOUSHIN_CONFIG.SEND_HEADER];
    if (sendCol) sheet.getRange(row, sendCol).setValue(false);
    ss.toast('送信に失敗しました。Webhook設定を確認してください。' + (errMsg ? '（' + errMsg + '）' : ''), 'エラー', 8);
  }
}

// ==================================================================
// ヘルパー
// ==================================================================
function soushinGetHeaderMap(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = sheet.getRange(SOUSHIN_CONFIG.HEADER_ROW, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach(function (h, i) {
    const name = String(h).trim();
    if (name) map[name] = i + 1;
  });
  return map;
}

function soushinFormatMoney(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  if (typeof v === 'number') return '¥' + v.toLocaleString('ja-JP');
  return String(v);
}

function soushinSafe(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  return String(v);
}

// ==================================================================
// Webhook 送信（Discord / Slack 両対応）
// ==================================================================
function soushinPostToWebhook(text) {
  const url = SOUSHIN_CONFIG.WEBHOOK_URL;
  if (!url || url.indexOf('http') !== 0) {
    throw new Error('WEBHOOK_URL が未設定です');
  }
  const payload = (SOUSHIN_CONFIG.WEBHOOK_TYPE === 'slack') ? { text: text } : { content: text };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  return code >= 200 && code < 300;
}

function soushinTestWebhook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ok = false, errMsg = '';
  try {
    ok = soushinPostToWebhook('✅ 接続テスト：依頼リストの自動送信は正常に動作しています。');
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }
  ss.toast(ok ? 'テスト送信に成功しました。' : ('テスト送信に失敗しました。' + (errMsg ? '（' + errMsg + '）' : '')), ok ? 'テストOK' : 'テスト失敗', ok ? 5 : 8);
}
