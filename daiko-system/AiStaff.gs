/**
 * AIスタッフと「AI店長」の週1朝礼
 *
 * 毎週月曜の朝9時に、Discordへ「今週の朝礼」を送ります。
 *   📊 分析係 … 先週の数字（注文・売上・リピート・待ち時間など）を見て、良かったこと・気になることを書く
 *   📚 改善係 … 先週「担当者行き」になった質問を読んで、マニュアルに足す文案を作る
 *   📣 広報係 … Xの投稿案と、LINE一斉送信の文案を作る
 *   🧑‍💼 AI店長 … みんなの報告をまとめて「今週やること」を3つにしぼる
 *
 * ルール：
 *   - 数字はプログラムが正確に数えます。AIは数字を作りません（コメントと提案だけ）
 *   - AIは提案するだけです。マニュアルの変更や一斉送信は、あなたが確認してから行います
 *   - 今すぐ試すときは、関数 weeklyMeeting を選んで ▷実行
 *   - 「AI店長メモ」シートのB2に、来週の予定（新ツム・イベントなど）を書くと、広報係がそれに合わせます
 *   - 係ごとにDiscordのチャンネルを分けるときは、スクリプト プロパティに
 *     DISCORD_MANAGER（店長）・DISCORD_ANALYST（分析係）・DISCORD_IMPROVER（改善係）・DISCORD_PROMOTER（広報係）
 *     の名前で、それぞれのWebhook URLを入れます（入れていない係は、通常チャンネルに届きます）
 */

var STAFF = {
  LOG_SHEET: "担当者行きログ",
  REPORT_SHEET: "AI朝礼",
  MEMO_SHEET: "AI店長メモ",
  MAX_TOKENS: 1500
};

// ===================================================================
// 担当者行きの記録（改善係が読む）
// ===================================================================
function escalationSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STAFF.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STAFF.LOG_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([["日時", "お客さん名", "理由", "メッセージ"]]).setFontWeight("bold").setBackground("#f1f3f4");
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 担当者行きになったことを記録する（IDやパスワードらしきものは記録しない）*/
function logEscalation(name, text, reason) {
  try { escalationSheet().appendRow([new Date(), String(name || ""), String(reason || ""), safeForLog(text)]); }
  catch (e) { Logger.log("担当者行きの記録に失敗: " + e); }
}

function memoSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STAFF.MEMO_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STAFF.MEMO_SHEET);
    sh.getRange(1, 1, 2, 2).setValues([
      ["メモ", "内容（自由に書き換えてOK）"],
      ["来週の予定・イベント", "（例：11/10 新ツム追加、セレクトBOX更新）"]
    ]).setFontWeight("bold");
  }
  return sh;
}
function nextWeekMemo() {
  var v = String(memoSheet().getRange(2, 2).getValue() || "").trim();
  return (!v || v.indexOf("（例：") === 0) ? "" : v;
}

// ===================================================================
// 📊 数字を数える（AIは使わない）
// ===================================================================
/** 代行するゲームアカウントを見分けるための文字（メールアドレス。なければ「:」の前）*/
function accountKey(contact) {
  var m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(String(contact || ""));
  if (m) return m[0].toLowerCase();
  return String(contact || "").split(/[:：\s]/)[0].trim().toLowerCase();
}

/** 直近7日間と、その前の7日間の数字 */
function weeklyStats(now) {
  now = now || new Date();
  var DAY = 86400000;
  var from = new Date(now.getTime() - 7 * DAY), prevFrom = new Date(now.getTime() - 14 * DAY);
  var s = { from: from, to: now, orders: 0, revenue: 0, prevOrders: 0, prevRevenue: 0,
            newCustomers: 0, repeatCustomers: 0, repeatRate: 0, avgWaitHours: null,
            topItems: [], escalations: 0, pendingNow: 0 };
  var sheet = ordersSheet();
  var last = sheet ? sheet.getLastRow() : 0;
  if (last >= 2) {
    var v = sheet.getRange(2, 1, last - 1, DELIVERED_COL).getValues();
    var rows = v.map(function (r) {
      return { t: toDate(r[col("受付日時") - 1]), amount: Number(r[col("金額") - 1]) || 0,
               status: normStatus(r[col("ステータス") - 1]), menu: String(r[col("希望メニュー") - 1] || ""),
               key: accountKey(r[col("連絡先") - 1]), line: String(r[LINE_COL - 1] || ""),
               delivered: r[DELIVERED_COL - 1] ? toDate(r[DELIVERED_COL - 1]) : null };
    }).filter(function (r) { return r.t; });
    rows.sort(function (a, b) { return a.t - b.t; });

    var seenKey = {}, seenLine = {}, items = {}, waits = [];
    rows.forEach(function (r) {
      var repeat = (r.key && seenKey[r.key]) || (r.line && seenLine[r.line]);
      if (r.t >= from && r.t <= now) {
        s.orders++; s.revenue += r.amount;
        if (repeat) s.repeatCustomers++; else s.newCustomers++;
        r.menu.split(", ").forEach(function (n) { if (n) items[n] = (items[n] || 0) + 1; });
        if (r.delivered && r.delivered >= r.t) waits.push((r.delivered - r.t) / 3600000);
      } else if (r.t >= prevFrom && r.t < from) {
        s.prevOrders++; s.prevRevenue += r.amount;
      }
      if (r.key) seenKey[r.key] = true;
      if (r.line) seenLine[r.line] = true;
      if (r.status === "未対応" || r.status === "代行中" || r.status === "再入力待ち") s.pendingNow++;
    });
    s.repeatRate = s.orders ? Math.round(s.repeatCustomers / s.orders * 100) : 0;
    if (waits.length) s.avgWaitHours = Math.round(waits.reduce(function (a, b) { return a + b; }, 0) / waits.length * 10) / 10;
    s.topItems = Object.keys(items).map(function (n) { return { name: n, count: items[n] }; })
      .sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
  }
  s.escalations = recentEscalations(from, now).length;
  return s;
}

/** 期間内の担当者行き（新しい順・最大30件）*/
function recentEscalations(from, to) {
  var sh = escalationSheet(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .map(function (r) { return { t: toDate(r[0]), reason: String(r[2]), text: String(r[3]) }; })
    .filter(function (r) { return r.t && r.t >= from && r.t <= to; })
    .reverse().slice(0, 30);
}

function staffYen(n) { return "¥" + Number(n || 0).toLocaleString("ja-JP"); }
function staffMd(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, "MM/dd"); }

/** 数字の部分（プログラムが作る。AIは触らない）*/
function formatStats(s) {
  return [
    "📊 先週の数字（" + staffMd(s.from) + "〜" + staffMd(s.to) + "）",
    "注文：" + s.orders + "件（その前の週 " + s.prevOrders + "件）",
    "売上：" + staffYen(s.revenue) + "（その前の週 " + staffYen(s.prevRevenue) + "）",
    "リピート：" + s.repeatRate + "%（新規 " + s.newCustomers + "人・リピート " + s.repeatCustomers + "人）",
    "平均の待ち時間（受付→納品）：" + (s.avgWaitHours === null ? "データなし" : s.avgWaitHours + "時間"),
    "人気：" + (s.topItems.length ? s.topItems.map(function (t, i) { return (i + 1) + "位 " + t.name + "（" + t.count + "件）"; }).join("／") : "なし"),
    "担当者行き：" + s.escalations + "件",
    "いま対応待ち（未対応・代行中・再入力待ち）：" + s.pendingNow + "件"
  ].join("\n");
}

// ===================================================================
// AIスタッフ
// ===================================================================
function staffAsk(role, rules, input) {
  var system = [
    "あなたは「" + SHOP_NAME + "」（ツムツム代行のお店）の" + role + "です。オーナーに向けて、日本語でわかりやすく短く書きます。",
    "専門用語は使わず、箇条書きで。前置きやあいさつは書きません。",
    "数字は、渡されたものだけを使います。自分で数字を作りません。",
    "お店の料金・ルール・約束は、下の【マニュアル】に書いてあることだけを使います。書いていないことは「（オーナーが決める）」と書きます。",
    "",
    rules,
    "",
    "【マニュアル】",
    buildManual()
  ].join("\n");
  return callClaude(system, "【今日の日付】" + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy/MM/dd"),
    [{ role: "user", content: input }], STAFF.MAX_TOKENS).trim();
}

/** 📊 分析係 */
function analystReport(stats) {
  return staffAsk("分析係",
    "【やること】数字を見て、「✅ 良かったこと」を1〜2個、「⚠️ 気になること」を1〜2個、それぞれ1行で書きます。全体で300文字以内。",
    formatStats(stats));
}

/** 📚 改善係 */
function improverReport(escalations) {
  if (!escalations.length) return "今週は、担当者行きになった質問はありませんでした👏";
  var list = escalations.map(function (e, i) { return (i + 1) + ". " + e.text + "（理由：" + e.reason + "）"; }).join("\n");
  return staffAsk("改善係",
    "【やること】ボットが答えられずに担当者行きになったお客さんのメッセージを読んで、マニュアルに足すとよい項目を、多い順に最大3つ提案します。\n" +
    "それぞれ「❓ よくある質問：」「📝 マニュアルに足す文案：」の2行で書きます。\n" +
    "文案の答えがマニュアルからわからないときは、作らずに「（オーナーが答えを書く）」とします。\n" +
    "返金・クレーム・BANなど、担当者が対応すべきものは、マニュアルに足さなくてよいので省きます。全体で600文字以内。",
    "【先週の担当者行き】\n" + list);
}

/** 📣 広報係 */
function promoterReport(stats) {
  var memo = nextWeekMemo();
  return staffAsk("広報係",
    "【やること】次の2つを作ります。\n" +
    "1.「🐦 Xの投稿案」を2本。それぞれ120文字以内。宣伝しすぎず、ツムツムをする人の役に立つ・共感する内容にして、最後に公式LINEへ軽く誘う。ハッシュタグは #ツムツム #ツムツム代行 など2〜3個。\n" +
    "2.「💬 LINE一斉送信の案」を1本。1行は全角14文字くらいまでで改行し、絵文字を2〜4個。\n" +
    "割引・キャンペーンは、メモに書いてあるときだけ使います。勝手に作りません。全体で700文字以内。",
    "【来週の予定・イベント】" + (memo || "（特になし）") + "\n【先週の人気商品】" +
    (stats.topItems.length ? stats.topItems.map(function (t) { return t.name; }).join("、") : "（データなし）"));
}

/** 🧑‍💼 AI店長 */
function managerReport(stats, analyst, improver, promoter) {
  return staffAsk("店長",
    "【やること】スタッフの報告を読んで、オーナーが「今週やること」を、大事な順に3つだけ、それぞれ1行で書きます。\n" +
    "形式：「📝 今週やること」の見出しのあとに「1. 〜」「2. 〜」「3. 〜」。必要なら「（改善係の文案あり）」のように、どの報告を見ればいいかを添えます。全体で300文字以内。",
    formatStats(stats) + "\n\n【分析係】\n" + analyst + "\n\n【改善係】\n" + improver + "\n\n【広報係】\n" + promoter);
}

// ===================================================================
// 週1の朝礼（月曜9時に自動で動く）
// ===================================================================
function weeklyMeeting() {
  var now = new Date();
  var stats = weeklyStats(now);
  var esc = recentEscalations(stats.from, now);
  var safe = function (fn) {
    try { return fn(); } catch (e) { Logger.log("AIスタッフのエラー: " + e); return "（AIが作れませんでした。CLAUDE_API_KEY や、実行数のログを確認してください）"; }
  };
  var analyst = safe(function () { return analystReport(stats); });
  var improver = safe(function () { return improverReport(esc); });
  var promoter = safe(function () { return promoterReport(stats); });
  var manager = safe(function () { return managerReport(stats, analyst, improver, promoter); });

  var parts = [
    "🧑‍💼 今週の朝礼（AI店長より）\n\n" + formatStats(stats) + "\n\n" + manager,
    "📊 分析係より\n" + analyst,
    "📚 改善係より\n" + improver + "\n\n※マニュアルを変えるときは、内容を確認してから Manual.gs に足してください",
    "📣 広報係より\n" + promoter + "\n\n※投稿・送信する前に、内容を確認してください"
  ];
  // 係ごとのチャンネル（スクリプト プロパティ）に送る。設定がなければ、いつもの通常チャンネルへ
  ["DISCORD_MANAGER", "DISCORD_ANALYST", "DISCORD_IMPROVER", "DISCORD_PROMOTER"].forEach(function (name, i) {
    discordSend(prop(name) || discordUrl(false), noMention(parts[i]));
  });
  saveReport(now, parts.join("\n\n━━━━━━━━━━\n\n"));
  return parts;
}

function saveReport(now, text) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STAFF.REPORT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STAFF.REPORT_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([["日時", "朝礼の内容"]]).setFontWeight("bold").setBackground("#f1f3f4");
    sh.setFrozenRows(1);
  }
  sh.appendRow([Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy/MM/dd HH:mm"), text]);
}
