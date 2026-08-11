/**
 * 依頼フロー自動化（Discord通知 ＋ 優先チャンネル振り分け ＋ 完了で行削除）
 * ==================================================================
 * 動き：
 *   1. 新しい依頼がシートに入り、必須項目がそろうと → 自動でDiscordに通知
 *      - 希望メニューが「依頼優先権」を含む → 優先チャンネルへ
 *      - それ以外 → 通常チャンネルへ
 *   2. I列（ステータス）のチェックを入れる → その行を削除（前の依頼は残らない）
 *
 * 列の対応（この設定で固定）：
 *   B=受付番号 / C=希望メニュー / E=金額 / F=連絡先 / G=備考 / H=写真 / I=ステータス
 *   K列 … 送信済みフラグ（重複送信を防ぐための内部用。隠してOK）
 *
 * 導入：
 *   1. Apps Script にこのコードを貼る
 *   2. 下の RF_CONFIG に「通常」「優先」2つのWebhook URL とシート名を設定
 *   3. 関数一覧で「rfSetup」を選び ▶実行（初回だけ・権限許可が必要）
 *   4. スプレッドシートを再読み込み
 */

// ==================================================================
// 設定（ここを書き換える）
// ==================================================================
const RF_CONFIG = {
  SHEET_NAME: 'シート1',   // あなたのシート（タブ）名

  // Discord Webhook URL（チャンネルごとに1つずつ作る）
  WEBHOOK_NORMAL:   'ここに「通常」チャンネルのWebhook URL',
  WEBHOOK_PRIORITY: 'ここに「優先」チャンネルのWebhook URL',

  // 希望メニューがこの文字を含む依頼を「優先」とみなす
  PRIORITY_KEYWORD: '依頼優先権',

  HEADER_ROW: 1,

  // 列番号（A=1, B=2, ...）
  COL: {
    受付番号: 2,   // B
    希望メニュー: 3, // C
    金額: 5,       // E
    連絡先: 6,     // F
    備考: 7,       // G
    写真: 8,       // H
    ステータス: 9,  // I
  },

  // この項目が「全部」埋まったら自動送信する（1回だけ）
  REQUIRED: ['受付番号', '希望メニュー', '金額', '連絡先'],

  // 送信メッセージに載せる項目（この順で本文に出る）
  FIELDS: ['受付番号', '希望メニュー', '金額', '連絡先', '備考', '写真'],

  SENT_FLAG_COL: 11, // K列（送信済みフラグ・内部用）
  CHECKBOX_ROWS: 1000,
};

// ==================================================================
// メニュー（インストール型 onOpen から呼ばれる）
// ==================================================================
function rfOnOpen() {
  SpreadsheetApp.getUi()
    .createMenu('依頼管理')
    .addItem('初期設定（チェックボックス＋自動化ON）', 'rfSetup')
    .addSeparator()
    .addItem('送信テスト（通常チャンネル）', 'rfTestNormal')
    .addItem('送信テスト（優先チャンネル）', 'rfTestPriority')
    .addToUi();
}

// ==================================================================
// 初期設定
// ==================================================================
function rfSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RF_CONFIG.SHEET_NAME);
  if (!sheet) {
    ss.toast('「' + RF_CONFIG.SHEET_NAME + '」というシートが見つかりません。RF_CONFIG.SHEET_NAME を実際のシート名に合わせてください。', 'エラー', 8);
    return;
  }

  const startRow = RF_CONFIG.HEADER_ROW + 1;
  const rowsAvail = sheet.getMaxRows() - startRow + 1;
  const n = Math.min(RF_CONFIG.CHECKBOX_ROWS, rowsAvail);

  // I列（ステータス）にチェックボックスを敷く
  if (n > 0) {
    sheet.getRange(startRow, RF_CONFIG.COL.ステータス, n, 1).insertCheckboxes();
  }

  // K列（送信済みフラグ）の見出しを付けて列を隠す
  sheet.getRange(RF_CONFIG.HEADER_ROW, RF_CONFIG.SENT_FLAG_COL).setValue('送信済(内部用)');
  sheet.hideColumns(RF_CONFIG.SENT_FLAG_COL);

  rfInstallTriggers();

  ss.toast('初期設定が完了しました。ページを再読み込みしてください。', 'セットアップ完了', 6);
}

function rfInstallTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'rfOnEdit' || fn === 'rfOnOpen') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rfOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('rfOnOpen').forSpreadsheet(ss).onOpen().create();
}

// ==================================================================
// 本体：編集を検知
// ==================================================================
function rfOnEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== RF_CONFIG.SHEET_NAME) return;

  const row = range.getRow();
  if (row <= RF_CONFIG.HEADER_ROW) return;

  const editedCol = range.getColumn();
  const numCols = range.getNumColumns();
  const colStart = editedCol;
  const colEnd = editedCol + numCols - 1;

  // (1) ステータス（I列）が変わった → 完了なら行削除
  const statusCol = RF_CONFIG.COL.ステータス;
  if (statusCol >= colStart && statusCol <= colEnd) {
    const statusVal = sheet.getRange(row, statusCol).getValue();
    if (statusVal === true || String(statusVal).indexOf('完了') >= 0) {
      sheet.deleteRow(row);
      SpreadsheetApp.getActiveSpreadsheet().toast('依頼完了：行を削除しました。', '完了', 3);
      return;
    }
  }

  // (2) データ列が編集された → 必須がそろい、未送信なら自動送信
  rfMaybeSend(sheet, row);
}

// 必須項目がそろっていて未送信なら送る
function rfMaybeSend(sheet, row) {
  // すでに送信済みならスキップ
  const flagCell = sheet.getRange(row, RF_CONFIG.SENT_FLAG_COL);
  if (String(flagCell.getValue()) === 'sent') return;

  // 必須項目がすべて埋まっているか
  const allFilled = RF_CONFIG.REQUIRED.every(function (name) {
    const col = RF_CONFIG.COL[name];
    const v = sheet.getRange(row, col).getValue();
    return v !== '' && v !== null && v !== undefined;
  });
  if (!allFilled) return;

  // メッセージ本文を組み立て
  const parts = [];
  RF_CONFIG.FIELDS.forEach(function (name) {
    const col = RF_CONFIG.COL[name];
    let raw = col ? sheet.getRange(row, col).getValue() : '';
    const display = (name === '金額') ? rfFormatMoney(raw) : rfSafe(raw);
    parts.push(name + '：' + display);
  });

  // 優先判定
  const menuVal = String(sheet.getRange(row, RF_CONFIG.COL.希望メニュー).getValue());
  const isPriority = menuVal.indexOf(RF_CONFIG.PRIORITY_KEYWORD) >= 0;

  // 受付完了時刻（日本時間）
  const uketsukeTime = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd (E) HH:mm');

  const header = isPriority ? '🔴【優先依頼】' : '🆕 新しい依頼';
  const message = header + '\n受付時刻：' + uketsukeTime + '\n' + parts.join('\n');
  const url = isPriority ? RF_CONFIG.WEBHOOK_PRIORITY : RF_CONFIG.WEBHOOK_NORMAL;

  let ok = false, errMsg = '';
  try {
    ok = rfPost(url, message);
  } catch (err) {
    errMsg = err && err.message ? err.message : String(err);
  }

  if (ok) {
    flagCell.setValue('sent'); // 二重送信防止
    SpreadsheetApp.getActiveSpreadsheet().toast(
      (isPriority ? '優先' : '通常') + 'チャンネルに送信しました。', '送信完了', 3);
  } else {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '送信に失敗しました。Webhook設定を確認してください。' + (errMsg ? '（' + errMsg + '）' : ''), 'エラー', 8);
  }
}

// ==================================================================
// ヘルパー
// ==================================================================
function rfFormatMoney(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  if (typeof v === 'number') return '¥' + v.toLocaleString('ja-JP');
  return String(v);
}

function rfSafe(v) {
  if (v === '' || v === null || v === undefined) return '（未入力）';
  return String(v);
}

function rfPost(url, text) {
  if (!url || url.indexOf('http') !== 0) throw new Error('Webhook URL が未設定です');
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ content: text }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  return code >= 200 && code < 300;
}

function rfTestNormal() {
  const ok = rfPost(RF_CONFIG.WEBHOOK_NORMAL, '✅ 通常チャンネルの接続テストです。');
  SpreadsheetApp.getActiveSpreadsheet().toast(ok ? '通常チャンネルに送信成功' : '送信失敗（URLを確認）', 'テスト', 5);
}

function rfTestPriority() {
  const ok = rfPost(RF_CONFIG.WEBHOOK_PRIORITY, '🔴 優先チャンネルの接続テストです。');
  SpreadsheetApp.getActiveSpreadsheet().toast(ok ? '優先チャンネルに送信成功' : '送信失敗（URLを確認）', 'テスト', 5);
}
