/**
 * ツムツム代行：受付システム本体
 *
 * お客さん … 注文フォーム → LINEで受付完了 → 納品のお知らせ → 「ありがとう」で完了
 * 管理者   … 管理ページ（?page=admin）
 * 代行者   … 代行者ページ（?page=worker）※必要な情報だけ見える
 * ボット   … Bot.gs（LINEの自動返信）
 *
 * 秘密の文字（パスワード・APIキー・Webhook URL）は、このファイルには書きません。
 * 「プロジェクトの設定 → スクリプト プロパティ」に保存します（README.md 参照）。
 */

// ===== 設定（商品と金額・列の並びなど。秘密ではないものだけ）=====
var CONFIG = {
  MENUS: {
    "コイン指定（5万〜2億）": 300,
    "プレイヤーレベルMAX": 200,
    "ツムレベルMAX 1体": 300,
    "スコアカンスト（指定可能）": 200,
    "プレミアムBOX完売": 1500,
    "セレクトBOX完売": 1000,
    "依頼優先権": 300,
    "BAN保証": 300
  },
  SHEET_NAME: "受付",
  HEADER: ["受付日時", "受付番号", "依頼者", "希望メニュー", "数量", "金額", "連絡先", "備考", "支払い写真", "ステータス"],
  STATUSES: ["未対応", "代行中", "再入力待ち", "納品済", "完了"],
  DEFAULT_STATUS: "未対応",
  RECEIPT_PREFIX: "T",
  TIMEZONE: "Asia/Tokyo",
  APP_TITLE: "受付フォーム",
  PHOTO_FOLDER_NAME: "受付_支払い写真",
  REQUIRE_PHOTO: true,
  PRIORITY_KEYWORD: "依頼優先権",
  REMIND_MINUTES: 30,
  AUTO_COMPLETE_HOURS: 24    // 納品済のまま返事がないとき、何時間で自動で完了にするか
};

// 見出しの右側にある「内部用の列」（自動で隠します）
var MSG_ID_COL = CONFIG.HEADER.length + 1; // Discordのメッセージ番号（完了で消すため）
var TOKEN_COL = CONFIG.HEADER.length + 2;  // 確認コードの元（LINE連携用）
var REMIND_COL = CONFIG.HEADER.length + 3; // リマインド済みの印
var LINE_COL = CONFIG.HEADER.length + 4;   // お客さんのLINE（連携後に入る）
var FIX_COL = CONFIG.HEADER.length + 5;    // お客さんがアカウントを入力し直した回数
var DELIVERED_COL = CONFIG.HEADER.length + 6; // 納品済にした日時（自動で完了にするため）

// ===== 小さな道具 =====
function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || "";
}
function col(name) { return CONFIG.HEADER.indexOf(name) + 1; }
/** このアプリのURL（スクリプト プロパティに APP_URL があれば、それを使う）*/
function appUrl() { return prop("APP_URL") || ScriptApp.getService().getUrl(); }
function makeToken() { return Utilities.getUuid().replace(/-/g, ""); }
function ordersSheet() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME); }

function lockRun(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** シートの日時セルは、文字でも日付でも入っていることがあるので、同じ形の文字にそろえる */
function fmtCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TIMEZONE, "yyyy/MM/dd HH:mm:ss");
  return String(v === null || v === undefined ? "" : v);
}
function toDate(v) {
  if (v instanceof Date) return v;
  var d = new Date(String(v).replace(/-/g, "/"));
  return isNaN(d.getTime()) ? null : d;
}
function normStatus(s) {
  s = String(s || "").trim();
  if (!s) return "未対応";
  if (s.indexOf("対応中") >= 0) return "代行中"; // 以前の呼び名
  return s;
}
function isPriorityMenu(menuText) {
  return String(menuText || "").indexOf(CONFIG.PRIORITY_KEYWORD) >= 0;
}
function isAdmin(key) { var k = prop("ADMIN_KEY"); return !!k && String(key) === k; }
function isWorker(key) { var k = prop("WORKER_KEY"); return !!k && String(key) === k; }

/** LINEで「受付番号 ○○ コード ○○」と送ってもらうためのリンク */
function buildLineUrl(basicId, text) {
  var id = String(basicId || "").trim();
  if (!id) return "";
  if (id.charAt(0) !== "@") id = "@" + id;
  return "https://line.me/R/oaMessage/@" + encodeURIComponent(id.slice(1)) + "/?" + encodeURIComponent(text);
}

// ===== 画面を開く =====
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "form";
  if (page === "admin" || page === "worker") {
    return HtmlService.createHtmlOutputFromFile(page)
      .setTitle(page === "admin" ? "管理ページ" : "代行者ページ")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (page === "fix") { // お客さん：アカウントの入力し直し
    var f = HtmlService.createTemplateFromFile("fix");
    f.no = String(e.parameter.no || "");
    f.tk = String(e.parameter.t || "");
    return f.evaluate()
      .setTitle("アカウントの再入力")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var t = HtmlService.createTemplateFromFile("form");
  t.menusJson = JSON.stringify(CONFIG.MENUS);
  t.appTitle = CONFIG.APP_TITLE;
  t.requirePhoto = CONFIG.REQUIRE_PHOTO ? "true" : "false";
  return t.evaluate()
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===== お客さん：注文を受け取る =====
function submitOrder(input) {
  var sheet = ordersSheet();
  if (!sheet) return { ok: false, message: "受付シートがありません。setup を実行してください。" };

  var selected = input.selected || [];
  var requester = String(input.requester || "").trim();
  var account = String(input.contact || "").trim();
  var note = String(input.note || "").trim();
  var amount = Number(input.amount);

  var chosen = [];
  for (var i = 0; i < selected.length; i++) {
    var nm = String(selected[i] || "").trim();
    if (CONFIG.MENUS.hasOwnProperty(nm) && chosen.indexOf(nm) < 0) chosen.push(nm);
  }
  if (!chosen.length) return { ok: false, message: "商品を1つ以上選んでください。" };
  if (!requester) return { ok: false, message: "ご依頼者（LINEの表示名）を入力してください。" };
  if (!account) return { ok: false, message: "代行するアカウントを入力してください。" };
  if (!(amount >= 0) || isNaN(amount)) return { ok: false, message: "金額を正しく入力してください。" };

  var hasImage = !!(input.image && input.image.dataUrl);
  if (CONFIG.REQUIRE_PHOTO && !hasImage) return { ok: false, message: "支払いの写真を添付してください。" };

  // 同じ内容の連続送信（押しすぎ）を60秒止める
  var cache = CacheService.getScriptCache();
  var sig = "sub_" + Utilities.base64EncodeWebSafe(account + "|" + amount + "|" + chosen.join(",")).slice(0, 200);
  if (cache.get(sig)) return { ok: false, message: "同じ内容が連続で送信されています。少し待ってからお試しください。" };

  var result;
  try {
    result = lockRun(function () {
      var now = new Date();
      var receiptNo = generateReceiptNo(sheet, now);
      var photoUrl = hasImage ? savePhotoToDrive(input.image, receiptNo) : "";
      var record = {
        "受付日時": Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy/MM/dd HH:mm:ss"),
        "受付番号": receiptNo, "依頼者": requester, "希望メニュー": chosen.join(", "),
        "数量": chosen.length, "金額": amount, "連絡先": account, "備考": note,
        "支払い写真": photoUrl, "ステータス": CONFIG.DEFAULT_STATUS
      };
      sheet.appendRow(CONFIG.HEADER.map(function (c) { return record[c] !== undefined ? record[c] : ""; }));
      var row = sheet.getLastRow();
      var token = makeToken();
      sheet.getRange(row, TOKEN_COL).setValue(token);
      if (isPriorityMenu(record["希望メニュー"])) {
        sheet.getRange(row, 1, 1, CONFIG.HEADER.length).setBackground("#fff2cc");
      }
      return { row: row, record: record, token: token };
    });
  } catch (e) {
    return { ok: false, message: "受付に失敗しました。もう一度お試しください。（" + (e && e.message ? e.message : e) + "）" };
  }
  cache.put(sig, "1", 60);

  try { notifyDiscord(result.record, result.row); }
  catch (e) { Logger.log("Discord通知に失敗: " + e); }

  var receiptNo2 = result.record["受付番号"];
  var lineText = "受付番号 " + receiptNo2 + " コード " + result.token.substring(0, 6);
  return {
    ok: true,
    receiptNo: receiptNo2,
    lineText: lineText,
    lineUrl: buildLineUrl(prop("LINE_BASIC_ID"), lineText)
  };
}

function generateReceiptNo(sheet, now) {
  var prefix = CONFIG.RECEIPT_PREFIX + "-" + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyyMMdd") + "-";
  var last = sheet.getLastRow();
  var count = 0;
  if (last >= 2) {
    var v = sheet.getRange(2, col("受付番号"), last - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) { if (String(v[i][0]).indexOf(prefix) === 0) count++; }
  }
  return prefix + ("00" + (count + 1)).slice(-3);
}

function savePhotoToDrive(image, receiptNo) {
  var m = /^data:([^;]+);base64,(.+)$/.exec(image.dataUrl || "");
  if (!m) throw new Error("画像データの形式が不正です。");
  var ext = m[1].indexOf("png") >= 0 ? "png" : "jpg";
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], receiptNo + "_payment." + ext);
  var it = DriveApp.getFoldersByName(CONFIG.PHOTO_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.PHOTO_FOLDER_NAME);
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return file.getUrl();
}

// ===== Discord（「知らせる」専用）=====
function discordUrl(isPriority) {
  return prop(isPriority ? "DISCORD_PRIORITY" : "DISCORD_NORMAL");
}
function discordText(text) {
  var url = discordUrl(false);
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, { method: "post", contentType: "application/json",
      payload: JSON.stringify({ content: String(text).slice(0, 1900) }), muteHttpExceptions: true });
  } catch (e) { Logger.log("Discord送信失敗: " + e); }
}
/** 管理者への連絡（Discord） */
function notifyAdmin(text) { discordText(text); }

function notifyDiscord(record, row) {
  var priority = isPriorityMenu(record["希望メニュー"]);
  var url = discordUrl(priority);
  if (!url) return;
  // 代行アカウントの情報と支払い写真は、Discordには載せません（管理ページでだけ見られます）
  var embed = {
    title: priority ? "🔴 優先依頼" : "🆕 新しい依頼",
    url: appUrl() + "?page=admin",
    color: priority ? 15158332 : 3066993,
    fields: [
      { name: "依頼者(LINE名)", value: String(record["依頼者"] || "-"), inline: true },
      { name: "受付番号", value: String(record["受付番号"]), inline: true },
      { name: "希望メニュー", value: String(record["希望メニュー"]), inline: false },
      { name: "金額", value: "¥" + Number(record["金額"]).toLocaleString("ja-JP"), inline: true },
      { name: "備考", value: String(record["備考"] || "（なし）").slice(0, 300), inline: false }
    ],
    footer: { text: "タイトルを押すと管理ページが開きます" }
  };
  var res = UrlFetchApp.fetch(url + "?wait=true", { method: "post", contentType: "application/json",
    payload: JSON.stringify({ embeds: [embed] }), muteHttpExceptions: true });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return;
  var msgId = String((JSON.parse(res.getContentText()) || {}).id || "");
  if (msgId) ordersSheet().getRange(row, MSG_ID_COL).setValue(msgId);
}

function deleteDiscordMessage(sheet, row) {
  var msgId = String(sheet.getRange(row, MSG_ID_COL).getValue());
  if (!msgId) return;
  var url = discordUrl(isPriorityMenu(sheet.getRange(row, col("希望メニュー")).getValue()));
  if (url) { try { UrlFetchApp.fetch(url + "/messages/" + msgId, { method: "delete", muteHttpExceptions: true }); } catch (e) {} }
  sheet.getRange(row, MSG_ID_COL).clearContent();
}

// ===== ステータスを進める（管理ページ・代行者ページ・シート直接 すべてここを通る）=====
function setOrderStatus(sheet, row, status, opts) {
  sheet.getRange(row, col("ステータス")).setValue(status);
  applyStatusEffects(sheet, row, status, opts || {});
}

function applyStatusEffects(sheet, row, status, opts) {
  var receiptNo = String(sheet.getRange(row, col("受付番号")).getValue());
  var userId = String(sheet.getRange(row, LINE_COL).getValue());

  if (status === "納品済") {
    sheet.getRange(row, DELIVERED_COL).setValue(new Date());
    var msg = "🎉 代行が完了して\n商品を納品しました！\n\n✅ 内容をご確認ください\n\n👍 問題なければ\n「OK」「ありがとう」と\n返信してください\n\n💬 気になる点があれば\nそのままご連絡ください\n\n⏰ ご返信がなくても\n" + CONFIG.AUTO_COMPLETE_HOURS + "時間後に\n自動で完了になります";
    if (!(userId && linePush(userId, msg))) {
      notifyAdmin("⚠️ " + receiptNo + " は納品済にしましたが、LINEでお知らせできませんでした（LINE未連携）。手動でご連絡ください。");
    }
  }
  if (status === "再入力待ち") {
    var url = fixUrl(sheet, row);
    if (!(userId && linePush(userId, refillMessage(receiptNo, url)))) {
      notifyAdmin("⚠️ " + receiptNo + " は「再入力待ち」にしましたが、LINEでお知らせできませんでした（LINE未連携）。\n次のリンクを、お客さんに手動で送ってください。\n" + url);
    }
  }
  if (status === "完了") {
    deleteDiscordMessage(sheet, row);
    if (userId) {
      if (opts.notifyCustomer !== false) linePush(userId, "🙏 ご利用ありがとう\nございました！\n\nまたのご利用を\nお待ちしております😊");
      markLineRecordDone(userId);
    }
  }
}

/** シートで直接ステータスを変えたときも、同じ動きにする */
function onStatusEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getColumn() !== col("ステータス")) return;
  var status = normStatus(e.range.getValue());
  if (e.oldValue !== undefined && normStatus(e.oldValue) === status) return;
  applyStatusEffects(sheet, e.range.getRow(), status, {});
}

// ===== アカウントの入力し直し（メアド・パスワードが違ったとき）=====
/** お客さん専用の、入力し直し用リンク */
function fixUrl(sheet, row) {
  return appUrl() + "?page=fix&no=" + encodeURIComponent(String(sheet.getRange(row, col("受付番号")).getValue())) +
    "&t=" + encodeURIComponent(String(sheet.getRange(row, TOKEN_COL).getValue()));
}
function refillMessage(receiptNo, url) {
  return "🔑 受付番号\n" + receiptNo + "\n\nご入力のアカウントで\nログインできませんでした🙏\n\n" +
    "👇 お手数ですが\n下のリンクから\n入力し直してください\n" + url +
    "\n\n⚠️ IDやパスワードは\nトークには送らないでください\n\n✅ 入力が終わると\n自動で代行を再開します";
}
/** リンクの受付番号と合言葉が正しく、いま「再入力待ち」の行を探す（なければ 0）*/
function findFixRow(sheet, receiptNo, tk) {
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return 0;
  var token = String(sheet.getRange(row, TOKEN_COL).getValue());
  if (!token || String(tk || "") !== token) return 0;
  return row;
}
/** 前に入力されたメールアドレスを、一部だけ見せる（パスワードは見せない）*/
function maskAccount(v) {
  var m = /([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/.exec(String(v || ""));
  if (!m) return "";
  return m[1].slice(0, 2) + "***@" + m[2];
}
function fixInfo(receiptNo, tk) {
  var sheet = ordersSheet();
  var row = findFixRow(sheet, receiptNo, tk);
  if (!row) return { ok: false, message: "リンクが正しくありません。LINEに届いたリンクを、もう一度開いてください。" };
  if (normStatus(sheet.getRange(row, col("ステータス")).getValue()) !== "再入力待ち") {
    return { ok: false, message: "この受付は、いまは入力し直しの必要がありません。ご不明な点は公式LINEにご連絡ください。" };
  }
  return { ok: true, receiptNo: String(receiptNo), menu: String(sheet.getRange(row, col("希望メニュー")).getValue()),
    hint: maskAccount(sheet.getRange(row, col("連絡先")).getValue()) };
}
function fixSubmit(receiptNo, tk, account) {
  account = String(account || "").trim();
  if (!account) return { ok: false, message: "メールアドレスとパスワードを入力してください。" };
  if (account.length > 300) return { ok: false, message: "入力が長すぎます。" };
  var sheet = ordersSheet();
  var done = lockRun(function () {
    var row = findFixRow(sheet, receiptNo, tk);
    if (!row || normStatus(sheet.getRange(row, col("ステータス")).getValue()) !== "再入力待ち") return 0;
    sheet.getRange(row, col("連絡先")).setValue(account);
    sheet.getRange(row, FIX_COL).setValue((Number(sheet.getRange(row, FIX_COL).getValue()) || 0) + 1);
    sheet.getRange(row, col("ステータス")).setValue("代行中");
    return row;
  });
  if (!done) return { ok: false, message: "この受付は、いまは入力し直しの必要がありません。" };
  notifyAdmin("🔁 " + receiptNo + " のアカウントが入力し直されました。代行者ページに戻っています。");
  return { ok: true };
}

// ===== LINEと注文を結びつける道具（Bot.gs から使います）=====
function findOrderRow(sheet, receiptNo) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var v = sheet.getRange(2, col("受付番号"), last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) { if (String(v[i][0]) === receiptNo) return i + 2; }
  return 0;
}
function ordersOfUser(sheet, userId) {
  var out = [];
  var last = sheet.getLastRow();
  if (last < 2 || !userId) return out;
  var vals = sheet.getRange(2, 1, last - 1, LINE_COL).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][LINE_COL - 1]) === userId) {
      out.push({ row: i + 2, receiptNo: String(vals[i][col("受付番号") - 1]),
        status: normStatus(vals[i][col("ステータス") - 1]), menu: String(vals[i][col("希望メニュー") - 1]) });
    }
  }
  return out; // 古い順
}

// ===== 管理ページ用 =====
function adminList(key) {
  if (!isAdmin(key)) return { ok: false };
  var sheet = ordersSheet(), out = [], last = sheet.getLastRow();
  if (last >= 2) {
    var v = sheet.getRange(2, 1, last - 1, LINE_COL).getValues();
    for (var i = 0; i < v.length; i++) {
      out.push({ no: String(v[i][col("受付番号") - 1]), requester: String(v[i][col("依頼者") - 1]),
        status: normStatus(v[i][col("ステータス") - 1]), menu: String(v[i][col("希望メニュー") - 1]),
        line: !!String(v[i][LINE_COL - 1]) });
    }
  }
  out.reverse();
  return { ok: true, list: out };
}

function adminDetail(key, receiptNo) {
  if (!isAdmin(key)) return { ok: false };
  var sheet = ordersSheet();
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return { ok: false };
  var v = sheet.getRange(row, 1, 1, LINE_COL).getValues()[0];
  var rec = {};
  for (var j = 0; j < CONFIG.HEADER.length; j++) rec[CONFIG.HEADER[j]] = (j === 0) ? fmtCell(v[j]) : String(v[j]);
  rec["ステータス"] = normStatus(rec["ステータス"]);
  return { ok: true, record: rec, line: !!String(v[LINE_COL - 1]),
    fixUrl: rec["ステータス"] === "再入力待ち" ? fixUrl(sheet, row) : "" };
}

function adminSetStatus(key, receiptNo, status) {
  if (!isAdmin(key)) return { ok: false };
  status = String(status || "").trim();
  if (CONFIG.STATUSES.indexOf(status) < 0) return { ok: false };
  var sheet = ordersSheet();
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return { ok: false };
  if (normStatus(sheet.getRange(row, col("ステータス")).getValue()) === status) return { ok: true, status: status };
  setOrderStatus(sheet, row, status, {});
  return { ok: true, status: status };
}

function adminSendLine(key, receiptNo, text) {
  if (!isAdmin(key)) return { ok: false };
  text = String(text || "").trim();
  if (!text) return { ok: false, reason: "メッセージが空です。" };
  var sheet = ordersSheet();
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return { ok: false, reason: "受付番号が見つかりません。" };
  var userId = String(sheet.getRange(row, LINE_COL).getValue());
  if (!userId) return { ok: false, reason: "このお客様はまだLINEと結びついていません。" };
  return linePush(userId, text) ? { ok: true } : { ok: false, reason: "LINEへの送信に失敗しました。" };
}

function adminStats(key) {
  if (!isAdmin(key)) return { ok: false };
  var sheet = ordersSheet(), now = new Date();
  var today = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy/MM/dd");
  var month = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy/MM");
  var s = { todayCnt: 0, todaySum: 0, monthCnt: 0, monthSum: 0, counts: { "未対応": 0, "代行中": 0, "再入力待ち": 0, "納品済": 0, "完了": 0 } };
  var last = sheet.getLastRow();
  if (last >= 2) {
    var v = sheet.getRange(2, 1, last - 1, CONFIG.HEADER.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var ts = fmtCell(v[i][col("受付日時") - 1]);
      var amt = Number(v[i][col("金額") - 1]) || 0;
      var st = normStatus(v[i][col("ステータス") - 1]);
      if (s.counts.hasOwnProperty(st)) s.counts[st]++;
      if (ts.indexOf(today) === 0) { s.todayCnt++; s.todaySum += amt; }
      if (ts.indexOf(month) === 0) { s.monthCnt++; s.monthSum += amt; }
    }
  }
  s.ok = true;
  return s;
}

// ===== 代行者ページ用（見せるのは、作業に必要な最低限だけ）=====
function workerList(key) {
  if (!isWorker(key)) return { ok: false };
  var sheet = ordersSheet(), out = [], last = sheet.getLastRow();
  if (last >= 2) {
    var v = sheet.getRange(2, 1, last - 1, FIX_COL).getValues();
    for (var i = 0; i < v.length; i++) {
      if (normStatus(v[i][col("ステータス") - 1]) !== "代行中") continue;
      out.push({ no: String(v[i][col("受付番号") - 1]), menu: String(v[i][col("希望メニュー") - 1]),
        account: String(v[i][col("連絡先") - 1]), note: String(v[i][col("備考") - 1]),
        fixed: (Number(v[i][FIX_COL - 1]) || 0) > 0 });
    }
  }
  return { ok: true, list: out };
}

function workerDeliver(key, receiptNo) {
  if (!isWorker(key)) return { ok: false };
  var sheet = ordersSheet();
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return { ok: false };
  if (normStatus(sheet.getRange(row, col("ステータス")).getValue()) !== "代行中") return { ok: false };
  setOrderStatus(sheet, row, "納品済", {});
  return { ok: true };
}

/** 代行者：ログインできなかった → お客さんに入力し直しを頼む */
function workerLoginFail(key, receiptNo) {
  if (!isWorker(key)) return { ok: false };
  var sheet = ordersSheet();
  var row = findOrderRow(sheet, String(receiptNo || "").trim());
  if (!row) return { ok: false };
  if (normStatus(sheet.getRange(row, col("ステータス")).getValue()) !== "代行中") return { ok: false };
  setOrderStatus(sheet, row, "再入力待ち", {});
  return { ok: true };
}

// ===== 自動のお知らせ =====
/** 30分以上「未対応」のままの依頼を、Discordに1回だけ知らせる */
function remindUnhandled() {
  var sheet = ordersSheet();
  if (!sheet) return;
  autoCompleteDelivered(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var v = sheet.getRange(2, 1, last - 1, REMIND_COL).getValues();
  var now = new Date();
  for (var i = 0; i < v.length; i++) {
    if (normStatus(v[i][col("ステータス") - 1]) !== "未対応") continue;
    if (String(v[i][REMIND_COL - 1]) === "done") continue;
    var t = toDate(v[i][col("受付日時") - 1]);
    if (!t) continue;
    if ((now - t) / 60000 >= CONFIG.REMIND_MINUTES) {
      notifyAdmin("⏰ まだ未対応の依頼があります\n受付番号: " + v[i][col("受付番号") - 1] + "\n依頼者: " + v[i][col("依頼者") - 1] + "\n" + appUrl() + "?page=admin");
      sheet.getRange(i + 2, REMIND_COL).setValue("done");
    }
  }
}

/**
 * 納品済のまま、お客さんから返事がない依頼を、決めた時間（24時間）で自動で完了にする
 * （remindUnhandled と一緒に、30分ごとに動きます。担当者が対応中のお客さんは除きます）
 */
function autoCompleteDelivered(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var v = sheet.getRange(2, 1, last - 1, DELIVERED_COL).getValues();
  var now = new Date();
  for (var i = 0; i < v.length; i++) {
    if (normStatus(v[i][col("ステータス") - 1]) !== "納品済") continue;
    var row = i + 2;
    var t = toDate(v[i][DELIVERED_COL - 1]);
    if (!v[i][DELIVERED_COL - 1] || !t) { sheet.getRange(row, DELIVERED_COL).setValue(now); continue; } // 時刻がない古い行は、今から数える
    if ((now - t) / 3600000 < CONFIG.AUTO_COMPLETE_HOURS) continue;
    var userId = String(v[i][LINE_COL - 1]);
    if (userId && getLineRecord(userId).status === "担当者待ち") continue; // 問題が起きているかもしれないので、残す
    setOrderStatus(sheet, row, "完了", { notifyCustomer: false });
    if (userId) {
      linePush(userId, "✅ 受付番号\n" + v[i][col("受付番号") - 1] + "\n\n納品から" + CONFIG.AUTO_COMPLETE_HOURS + "時間たったので\n完了にしました。\nご利用ありがとう\nございました🙏\n\n💬 気になる点があれば\nいつでもご連絡ください");
    }
  }
}

/** 毎朝、昨日のまとめをDiscordへ */
function dailySummary() {
  var sheet = ordersSheet();
  if (!sheet) return;
  var y = new Date(); y.setDate(y.getDate() - 1);
  var ymd = Utilities.formatDate(y, CONFIG.TIMEZONE, "yyyy/MM/dd");
  var cnt = 0, sum = 0, pending = 0, last = sheet.getLastRow();
  if (last >= 2) {
    var v = sheet.getRange(2, 1, last - 1, CONFIG.HEADER.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var st = normStatus(v[i][col("ステータス") - 1]);
      if (st === "未対応" || st === "代行中" || st === "再入力待ち") pending++;
      if (fmtCell(v[i][col("受付日時") - 1]).indexOf(ymd) === 0) { cnt++; sum += Number(v[i][col("金額") - 1]) || 0; }
    }
  }
  notifyAdmin("📊 昨日のまとめ(" + ymd + ")\n件数: " + cnt + "件\n売上: ¥" + sum.toLocaleString("ja-JP") + "\n対応待ち(未対応・代行中・再入力待ち): " + pending + "件");
}

// ===== 初期設定（最初に1回実行）=====
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  sheet.getRange(1, 1, 1, CONFIG.HEADER.length).setValues([CONFIG.HEADER]).setFontWeight("bold").setBackground("#f1f3f4");
  sheet.setFrozenRows(1);
  sheet.getRange(2, col("金額"), Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("#,##0");
  sheet.getRange(1, MSG_ID_COL).setValue("_msgId");
  sheet.getRange(1, TOKEN_COL).setValue("_code");
  sheet.getRange(1, REMIND_COL).setValue("_reminded");
  sheet.getRange(1, LINE_COL).setValue("_lineUser");
  sheet.getRange(1, FIX_COL).setValue("_fix");
  sheet.getRange(1, DELIVERED_COL).setValue("_delivered");
  sheet.hideColumns(MSG_ID_COL, 6);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.STATUSES, true).build();
  sheet.getRange(2, col("ステータス"), Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "onStatusEdit" || fn === "remindUnhandled" || fn === "dailySummary") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onStatusEdit").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("remindUnhandled").timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger("dailySummary").timeBased().everyDays(1).atHour(9).inTimezone(CONFIG.TIMEZONE).create();

  lineSheet(); // LINE記録シートも作る
  Logger.log("セットアップ完了。次は checkSecrets を実行してください。");
}

/** 秘密の設定がそろっているか確認します（中身は表示しません）*/
function checkSecrets() {
  var need = ["LINE_TOKEN", "CLAUDE_API_KEY", "WEBHOOK_KEY", "ADMIN_KEY", "WORKER_KEY", "DISCORD_NORMAL", "DISCORD_PRIORITY", "LINE_BASIC_ID"];
  var optional = ["APP_URL", "TEST_MODE", "TEST_USER_ID"];
  var missing = 0;
  need.forEach(function (n) { var ok = !!prop(n); if (!ok) missing++; Logger.log((ok ? "OK    " : "未設定 ") + n); });
  optional.forEach(function (n) { Logger.log((prop(n) ? "設定あり " : "（なし）  ") + n + "  ※必要なときだけ"); });
  Logger.log(missing ? "★ 未設定が " + missing + " 個あります。README の手順で追加してください。" : "必須の設定はすべてそろっています。");
  Logger.log(isTestMode()
    ? "いまは【テストモード】です。ボットは TEST_USER_ID の人（" + (prop("TEST_USER_ID") ? "設定あり" : "まだ未設定") + "）にだけ返事をします。"
    : "いまは【本番モード】です。ボットは全員に返事をします。");
}

function authorizeDrive() {
  var f = DriveApp.createFolder("__権限テスト__"); f.setTrashed(true);
  Logger.log("ドライブの書き込み権限OK");
}
