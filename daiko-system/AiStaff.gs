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
 *   - 広報係は毎月1日と15日に、ツムツムの予定（ガチャ・イベント）をネットで調べて「ツムツム予定」シートにまとめます
 *     （今すぐ調べるときは、関数 monthlyTsumSchedule を ▷実行）
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
    "【来週の予定・イベント（オーナーのメモ）】" + (memo || "（特になし）") +
    "\n【これから2週間のツムツムの予定（AIがネットで調べたもの。日付と内容はこのとおりに使う）】\n" +
    (function () { var ev = upcomingTsumEvents(14); return ev.length ? ev.map(function (x) { return "・" + x.start + (x.end ? "〜" + x.end : "") + " " + x.title + (x.detail ? "（" + x.detail + "）" : ""); }).join("\n") : "（なし）"; })() +
    "\n【先週の人気商品】" +
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

// ===================================================================
// 📅 広報係：ツムツムの予定（ガチャ・イベント）を、毎月1日と15日にネットで調べる
// ===================================================================
// ・Claude のネット検索を使います（検索1回あたり約1.5円。1回の調査で最大8回まで）
// ・調べた結果は「ツムツム予定」シートに入り、Discord（広報係）にも届きます
// ・出典（URL）がない情報は捨てます。それでもAIの調べものなので、投稿前に公式の告知で確認してください
var SCHEDULE = { SHEET: "ツムツム予定", MAX_SEARCHES: 8, MAX_TOKENS: 4000 };

function scheduleSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SCHEDULE.SHEET);
  if (!sh) {
    sh = ss.insertSheet(SCHEDULE.SHEET);
    sh.getRange(1, 1, 1, 6).setValues([["開始日", "終了日", "内容", "くわしく", "出典URL", "調べた日"]]).setFontWeight("bold").setBackground("#f1f3f4");
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ネット検索つきで Claude に聞く（長い調べもので一時停止したら、続きから再開する）*/
function callClaudeWithSearch(system, userText) {
  var key = prop("CLAUDE_API_KEY");
  if (!key) throw new Error("CLAUDE_API_KEY が未設定です");
  var messages = [{ role: "user", content: userText }];
  var texts = [], sources = [];
  for (var round = 0; round < 4; round++) {
    var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post", contentType: "application/json",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: BOT.MODEL,
        max_tokens: SCHEDULE.MAX_TOKENS,
        system: system,
        messages: messages,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: SCHEDULE.MAX_SEARCHES,
                  user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" } }]
      }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode(), body = res.getContentText();
    if (code !== 200) throw new Error("Claude API エラー " + code + " " + clip(body, 200));
    var data = JSON.parse(body);
    (data.content || []).forEach(function (b) {
      if (b.type === "text") {
        texts.push(b.text);
        (b.citations || []).forEach(function (c) { if (c.url) sources.push(c.url); });
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        b.content.forEach(function (r) { if (r.url) sources.push(r.url); });
      }
    });
    if (data.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: data.content }); // 一時停止：そのまま送り返すと続きから再開する
  }
  return { text: texts.join(""), sources: sources };
}

function ymd(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy/MM/dd"); }

/** 調べた結果（JSON）を読み取る。出典のないものは捨てる */
function parseSchedule(text) {
  var s = String(text || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  var list;
  try { list = JSON.parse(s.substring(a, b + 1)); } catch (e) { return null; }
  if (!Array.isArray(list)) return null;
  var normDate = function (v) {
    var m = /(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/.exec(String(v || ""));
    return m ? m[1] + "/" + ("0" + m[2]).slice(-2) + "/" + ("0" + m[3]).slice(-2) : "";
  };
  return list.map(function (x) {
    return { start: normDate(x.start), end: normDate(x.end), title: clip(String(x.title || "").trim(), 80),
             detail: clip(String(x.detail || "").trim(), 200), source: String(x.source || "").trim() };
  }).filter(function (x) { return x.start && x.title && /^https?:\/\//.test(x.source); })
    .sort(function (p, q) { return p.start < q.start ? -1 : p.start > q.start ? 1 : 0; })
    .slice(0, 40);
}

/** 毎月1日と15日に動く：今月と来月はじめのツムツムの予定を調べる */
function monthlyTsumSchedule() {
  var now = new Date();
  var to = new Date(now.getTime() + 45 * 86400000);
  var system = [
    "あなたは「" + SHOP_NAME + "」（ツムツム代行のお店）の広報係です。",
    "スマホゲーム「LINE:ディズニー ツムツム」の、これからの予定をネットで調べます。",
    "調べるもの：新ツムの登場、プレミアムBOX・セレクトBOX・ピックアップガチャの内容と期間、イベントの開始と終了、キャンペーン。",
    "公式の告知（公式のお知らせ・公式SNS）を優先し、なければ攻略サイトなど信頼できるサイトを使います。",
    "【守ること】",
    "- 調べて確かめられたことだけを書きます。予想やうわさは書きません。",
    "- 1つずつ、出典のURLを必ず付けます。URLがわからないものは書きません。",
    "- 日付がはっきりしないものは書きません。",
    "【出力】次の形のJSONの配列だけを出力します。前後に説明は書きません。",
    '[{"start":"2026-11-01","end":"2026-11-30","title":"短い見出し（例：新ツム登場）","detail":"くわしい内容（ツムの名前など）","source":"https://..."}]'
  ].join("\n");
  var user = "今日は " + ymd(now) + " です。" + ymd(now) + " から " + ymd(to) + " までのツムツムの予定を調べてください。";

  var result;
  try { result = callClaudeWithSearch(system, user); }
  catch (e) {
    var msg = String(e && e.message ? e.message : e);
    discordSend(prop("DISCORD_PROMOTER") || discordUrl(false), "📅 ツムツムの予定を調べられませんでした。\n" +
      (/web search|not enabled/i.test(msg) ? "Claude Console の設定で、ネット検索（Web search）が止められている可能性があります。" : "理由：" + clip(msg, 200)));
    return null;
  }
  var items = parseSchedule(result.text);
  if (!items || !items.length) {
    discordSend(prop("DISCORD_PROMOTER") || discordUrl(false), "📅 ツムツムの予定を、うまくまとめられませんでした（シートは前のままです）。\nAIの返事：\n" + clip(result.text, 1500));
    return null;
  }
  var sh = scheduleSheet(), last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 6).clearContent();
  sh.getRange(2, 1, items.length, 6).setValues(items.map(function (x) {
    return [x.start, x.end, x.title, x.detail, x.source, ymd(now)];
  }));
  var lines = items.map(function (x) {
    return "・" + x.start.slice(5) + (x.end ? "〜" + x.end.slice(5) : "") + "　" + x.title + (x.detail ? "（" + x.detail + "）" : "") + "\n　" + x.source;
  });
  discordSend(prop("DISCORD_PROMOTER") || discordUrl(false), noMention(
    "📅 これからのツムツムの予定（広報係がネットで調べました）\n※AIの調べものです。投稿や一斉送信の前に、公式の告知で確認してください\n\n" + lines.join("\n")));
  return items;
}

/** これから2週間（と、開催中）の予定。週1の広報係が使う */
function upcomingTsumEvents(days) {
  var sh = scheduleSheet(), last = sh.getLastRow();
  if (last < 2) return [];
  var today = ymd(new Date()), until = ymd(new Date(Date.now() + (days || 14) * 86400000));
  return sh.getRange(2, 1, last - 1, 4).getValues().map(function (r) {
    return { start: fmtCell(r[0]).slice(0, 10), end: fmtCell(r[1]).slice(0, 10), title: String(r[2]), detail: String(r[3]) };
  }).filter(function (x) {
    if (!x.start || !x.title) return false;
    var running = x.start <= today && (!x.end || x.end >= today);
    return running || (x.start >= today && x.start <= until);
  });
}
