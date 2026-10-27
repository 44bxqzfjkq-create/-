// 使い方： node daiko-system/test/run.js
// Googleスプレッドシート／LINE／Claude／Discord の代わりに「仮の部品」を使って、
// Code.gs と Bot.gs の動きを一通り確かめます。本物のサービスには一切つながりません。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.join(__dirname, "..");
let passed = 0;
const results = [];
const ALL_LINE_TEXTS = []; // ボットがLINEに送った文章（あとで、スマホの幅に収まっているか調べる）
function test(name, fn) {
  try { fn(); passed++; results.push("  OK   " + name); }
  catch (e) { results.push("  NG   " + name + "\n         " + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// ---------------- 仮のGoogle部品 ----------------
function makeEnv(props) {
  const logs = [];
  const fetchLog = [];
  const aiQueue = [];            // Claudeの返事（先頭から使う）
  const cacheStore = {};
  const sheets = {};

  function colToIdx(c) { return c - 1; }
  function makeSheet(name) {
    const data = []; // data[r-1][c-1]
    const sh = {
      name, data, frozen: 0,
      getName() { return name; },
      getMaxRows() { return 1000; },
      getLastRow() { for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some(v => v !== "" && v !== undefined)) return i + 1; return 0; },
      getLastColumn() { return Math.max(0, ...data.map(r => (r || []).length)); },
      appendRow(arr) { const r = sh.getLastRow() + 1; data[r - 1] = arr.slice(); },
      deleteRow(r) { data.splice(r - 1, 1); },
      setFrozenRows(n) { sh.frozen = n; },
      hideColumns() { return sh; },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        const rg = {
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? "" : v); } out.push(row); } return out; },
          getValue() { return rg.getValues()[0][0]; },
          setValue(v) { (data[r - 1] = data[r - 1] || [])[c - 1] = v; return rg; },
          setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = v; })); return rg; },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = ""; } return rg; },
          getRow() { return r; }, getColumn() { return c; }, getNumRows() { return nr; }, getSheet() { return sh; },
          setFontWeight() { return rg; }, setBackground() { return rg; }, setNumberFormat() { return rg; }, setDataValidation() { return rg; }
        };
        return rg;
      }
    };
    return sh;
  }
  const ss = {
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; }
  };

  const ctx = {
    console, Logger: { log: (m) => logs.push(String(m)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; },
      remove: (k) => { delete cacheStore[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: () => { const b = { requireValueInList() { return b; }, build() { return {}; } }; return b; }
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => "https://script.google.com/macros/s/TEST/exec" }),
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => { const t = { forSpreadsheet() { return t; }, onEdit() { return t; }, timeBased() { return t; }, everyMinutes() { return t; }, everyDays() { return t; }, atHour() { return t; }, inTimezone() { return t; }, create() { return t; } }; return t; }
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 1 }, Permission: { VIEW: 1 },
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ createFile: (b) => ({ setSharing() {}, getUrl: () => "https://drive.example/" + b.name }) })
    },
    HtmlService: {}, ContentService: { createTextOutput: (t) => ({ text: t }) },
    Utilities: {
      getUuid: () => "abcdef12-3456-7890-abcd-ef1234567890",
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString("base64"),
      base64Decode: (s) => Array.from(Buffer.from(s, "base64")),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      formatDate: (d, tz, f) => {
        const j = new Date(d.getTime() + 9 * 3600 * 1000), p = (n) => String(n).padStart(2, "0");
        return f.replace("yyyy", j.getUTCFullYear()).replace("MM", p(j.getUTCMonth() + 1)).replace("dd", p(j.getUTCDate()))
          .replace("HH", p(j.getUTCHours())).replace("mm", p(j.getUTCMinutes())).replace("ss", p(j.getUTCSeconds()));
      }
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        opts = opts || {};
        const body = opts.payload ? JSON.parse(opts.payload) : null;
        fetchLog.push({ url, method: opts.method || "get", body, headers: opts.headers || {} });
        if (url.indexOf("api.line.me/v2/bot/message") >= 0 && body) body.messages.forEach(m => ALL_LINE_TEXTS.push(m.text));
        const res = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
        if (url.indexOf("api.anthropic.com") >= 0) {
          const next = aiQueue.shift();
          if (!next) return res(500, "no scripted ai response");
          if (next.error) return res(next.error, "error body");
          return res(200, JSON.stringify({ content: [{ type: "text", text: next.text }] }));
        }
        if (url.indexOf("/profile/") >= 0) return res(200, JSON.stringify({ displayName: "花子" }));
        if (url.indexOf("discord.test") >= 0 && url.indexOf("wait=true") >= 0) return res(200, JSON.stringify({ id: "MSG" + fetchLog.length }));
        return res(200, "{}");
      }
    }
  };
  vm.createContext(ctx);
  for (const f of ["Manual.gs", "FixedReplies.gs", "Code.gs", "Bot.gs"]) {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
  }
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, run, logs, fetchLog, aiQueue, cacheStore, sheets, ss };
}

const BASE_PROPS = {
  LINE_TOKEN: "TOKEN", CLAUDE_API_KEY: "KEY", WEBHOOK_KEY: "secretkey", ADMIN_KEY: "adminpw", WORKER_KEY: "workerpw",
  DISCORD_NORMAL: "https://discord.test/normal", DISCORD_PRIORITY: "https://discord.test/priority", LINE_BASIC_ID: "@abc123"
};
const IMG = { dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const lineCalls = (env, kind) => env.fetchLog.filter(c => c.url.indexOf("/message/" + kind) >= 0);
const aiCalls = (env) => env.fetchLog.filter(c => c.url.indexOf("api.anthropic.com") >= 0);
const discordCalls = (env) => env.fetchLog.filter(c => c.url.indexOf("discord.test") >= 0);

// ---------------- 1. 文章を調べる部分 ----------------
{
  const env = makeEnv(BASE_PROPS);
  const cred = (t) => env.run("looksLikeCredentials")(t);
  const close = (t) => env.run("looksLikeClosing")(t);

  test("IDやパスワードらしき文字を見つける", () => {
    ["パスワードはabc12345です", "password: Tsumu1234", "メール taro@example.com pass1234", "taro@example.com:Pass1234",
     "ID: tsumu_user1", "ＩＤ：abc123", "Tsumu1234!!", "ログインID=abc12345",
     "パス abcd1234", "taro@example.com", "0901234567 abcd1234", "ぱすわーど tsumu2024", "パスワード：Hanako_Tsum",
     "メアド taro@example.com　パス Qwerty99", "暗証番号 1234abcd"].forEach(t => assert.ok(cred(t), "検出できない: " + t));
  });
  test("ふつうの質問は止めない", () => {
    ["パスワードは必要ですか？", "パスワード変更はできますか", "納期はどれくらいですか？", "T-20261024-001",
     "受付番号 T-20261024-001 コード a1b2c3", "ありがとうございます", "料金を教えてください", "09012345678", "メールアドレスは必要ですか",
     "パスワードはLINEで送ればいいですか？", "password reset?", "OK thanks", "パスタ食べたい", "https://example.com/abc123"]
      .forEach(t => assert.ok(!cred(t), "止めてしまう: " + t));
  });
  test("お礼・確認の言葉は「完了」と察知する", () => {
    ["ありがとう", "ありがとうございました！", "OK", "ｏｋです", "確認しました", "受け取りました", "助かりました", "大丈夫です", "了解です"]
      .forEach(t => assert.ok(close(t), "察知できない: " + t));
  });
  test("まだ問題がありそうな言葉は「完了」にしない", () => {
    ["ありがとう、でもまだ反映されてない", "ありがとう。次はいつですか？", "確認しました、おかしいです", "返金お願いします",
     "ありがとうございます！ところで別の依頼をお願いしたいのですが、料金はいくらになりますか", "token"]
      .forEach(t => assert.ok(!close(t), "完了にしてしまう: " + t));
  });
  test("受付番号とコードを取り出す", () => {
    const l = env.run("extractLink")("受付番号 T-20261024-001 コード A1B2C3");
    assert.strictEqual(l.receiptNo, "T-20261024-001"); assert.strictEqual(l.code, "a1b2c3");
    const l2 = env.run("extractLink")("Ｔ－20261024－001 code:ff00aa");
    assert.strictEqual(l2.receiptNo, "T-20261024-001"); assert.strictEqual(l2.code, "ff00aa");
  });
  test("AIの返事（JSON）を読み取る／壊れていたら null", () => {
    const p = env.run("parseAiJson");
    const ok = p('説明です {"reply":"こんにちは","need_staff":true,"closing":false,"summary":"料金の質問"} 以上');
    assert.strictEqual(ok.reply, "こんにちは"); assert.strictEqual(ok.needStaff, true); assert.strictEqual(ok.closing, false);
    assert.strictEqual(p("ただの文章"), null); assert.strictEqual(p('{"reply":""}'), null); assert.strictEqual(p("{壊れた}"), null);
  });
  test("LINEボタンのリンクが正しい形になる", () => {
    const u = env.run("buildLineUrl")("@abc123", "受付番号 T-1 コード aaaaaa");
    assert.strictEqual(u, "https://line.me/R/oaMessage/@abc123/?" + encodeURIComponent("受付番号 T-1 コード aaaaaa"));
    assert.strictEqual(env.run("buildLineUrl")("abc123", "x"), "https://line.me/R/oaMessage/@abc123/?x");
    assert.strictEqual(env.run("buildLineUrl")("", "x"), "");
  });
}

// ---------------- 2. 決まった返事 ----------------
{
  const env = makeEnv(BASE_PROPS);
  const fixed = env.run("matchFixedReply");
  test("未設定の決まった返事は送らない（AIに回す）", () => {
    assert.strictEqual(fixed("1"), null); assert.strictEqual(fixed("メニュー"), null); assert.strictEqual(fixed("納期"), null);
  });
  test("設定済みの決まった返事は、そのまま返す（全角・大文字小文字の違いも吸収）", () => {
    assert.ok(fixed("料金").indexOf("💴 300円\n・コイン指定（5万〜2億）\n・ツムレベルMAX 1体") >= 0, fixed("料金"));
    assert.ok(fixed("料金").indexOf("💴 1,500円\n・プレミアムBOX完売") >= 0, "値段の安い順にまとまっていない");
    assert.ok(fixed("【このままメッセージどうぞ】").indexOf("どうぞ") >= 0);
    assert.ok(fixed(" 流れ ").indexOf("ご注文の流れ") >= 0);
    env.run('FIXED_REPLIES["1"] = "これは1番の返事です"; FIXED_REPLIES["ギフト"] = "ギフトの返事"');
    assert.strictEqual(fixed("１"), "これは1番の返事です");
    assert.strictEqual(fixed("ギフト"), "ギフトの返事");
    assert.strictEqual(fixed("ギフトについて"), null);
  });
  test("AIに渡すマニュアルに料金表が入る", () => {
    assert.ok(env.run("buildManual")().indexOf("【料金表】") >= 0);
    assert.ok(env.run("buildManual")().indexOf("コイン指定（5万〜2億）：300円") >= 0);
    const m = env.run("buildManual")();
    ["1時間〜3日", "5分〜24時間", "キャンセルはできません", "こちらのミスがあった場合は、返金します", "BANされることは、ほぼありません"]
      .forEach(k => assert.ok(m.indexOf(k) >= 0, "マニュアルにない: " + k));
    assert.ok(/【よくある質問】\s*【未設定】/.test(m), "よくある質問は、まだ担当者に回す");
  });
  test("AIへの指示に、お店の名前・話し方・返事の例・守ること・マニュアルが入る", () => {
    const p = env.run("buildSystemStatic")();
    ["「じょーじ」", "【話し方】", "まず、聞かれたことにまっすぐ答えます", "【返事の例】", "need_staff: true",
     "うそはつかずに", "【未設定】のこと", "【マニュアル】", "1行は全角14文字"].forEach(k => assert.ok(p.indexOf(k) >= 0, "入っていない: " + k));
  });
  test("AIの長い返事は、句読点のところで改行し直して、スマホで変に折り返さない", () => {
    const wrap = (t) => env.run("wrapForPhone")(t, 14);
    const w = env.run("displayWidth");
    const long = "ご連絡ありがとうございます。どのようなご用件でしょうか？ご注文はメニューの「注文」から注文フォームをご利用ください。";
    const out = wrap(long);
    out.split("\n").forEach(l => assert.ok(w(l) <= 15, "長すぎる行: " + l + " (" + w(l) + ")"));
    assert.strictEqual(out.replace(/\n/g, ""), long, "文字が消えたり増えたりしている");
    const long2 = "料金やご注文の流れについてのご質問も、お気軽にどうぞ。";
    wrap(long2).split("\n").forEach(l => assert.ok(w(l) <= 15, "長すぎる行: " + l));
    assert.ok(wrap("すごいですね、ありがとうございます").indexOf("す\nごい") < 0, "言葉の途中で切っている");
    const nums = wrap("プレイヤーレベルMAXは200円でスコアカンストも200円です");
    nums.split("\n").forEach(l => assert.ok(w(l) <= 15, "長すぎる行: " + l));
    assert.ok(!/[0-9]\n[0-9]/.test(nums) && !/[0-9]\n円/.test(nums), "数字の途中で切っている: " + nums);
    assert.ok(nums.indexOf("200円") >= 0);
    assert.strictEqual(wrap("短い文です😊"), "短い文です😊");
    assert.strictEqual(wrap("https://script.google.com/macros/s/AAAAAAAAAAAAAAAAAAAAAAAAAAA/exec"), "https://script.google.com/macros/s/AAAAAAAAAAAAAAAAAAAAAAAAAAA/exec", "URLは切らない");
    assert.strictEqual(w("1️⃣ フォーム"), 2 + 0.5 + 4);
  });
}

// ---------------- 3. 注文からLINE連携・納品・完了まで ----------------
{
  const env = makeEnv(BASE_PROPS);
  env.run("setup")();
  const submit = (extra) => env.run("submitOrder")(Object.assign({ selected: ["コイン指定（5万〜2億）"], requester: "花子", amount: 300, contact: "a@b.com:secretPW99", note: "お願いします", image: IMG }, extra || {}));
  const handle = (uid, text) => { env.run("BOT_STATE").replied = false; env.run("handleTextMessage")(uid, "rt-" + Math.random(), text); };
  const sheet = () => env.sheets["受付"];
  const lastReply = () => { const c = lineCalls(env, "reply"); return c.length ? c[c.length - 1].body.messages[0].text : ""; };

  let order;
  test("注文を送ると、受付番号とLINE用のリンクが返る", () => {
    order = submit();
    assert.strictEqual(order.ok, true);
    assert.ok(/^T-\d{8}-001$/.test(order.receiptNo), order.receiptNo);
    assert.ok(/^受付番号 T-\d{8}-001 コード abcdef$/.test(order.lineText), order.lineText);
    assert.ok(order.lineUrl.indexOf("https://line.me/R/oaMessage/@abc123/?") === 0);
  });
  test("Discordの通知に、代行アカウント・パスワード・写真リンクが載らない", () => {
    const d = discordCalls(env).find(c => c.body && c.body.embeds);
    assert.ok(d, "Discord通知がない");
    const s = JSON.stringify(d.body);
    assert.ok(s.indexOf("secretPW99") < 0 && s.indexOf("a@b.com") < 0 && s.indexOf("drive.example") < 0, "漏れている");
    assert.ok(s.indexOf(order.receiptNo) >= 0 && s.indexOf("花子") >= 0);
  });
  test("連続で同じ内容を送ると止める", () => {
    const again = submit();
    assert.strictEqual(again.ok, false);
  });
  test("商品なし・依頼者なしは受け付けない", () => {
    assert.strictEqual(submit({ selected: [], contact: "x1" }).ok, false);
    assert.strictEqual(submit({ requester: "", contact: "x2" }).ok, false);
  });

  test("コードが違うと結びつかない／正しいコードで結びつく", () => {
    handle("U1", "受付番号 " + order.receiptNo + " コード 000000");
    assert.ok(lastReply().indexOf("合いませんでした") >= 0, lastReply());
    assert.strictEqual(String(sheet().getRange(2, 14).getValue()), "");
    handle("U1", order.lineText);
    assert.ok(lastReply().indexOf("確認しました") >= 0, lastReply());
    assert.strictEqual(String(sheet().getRange(2, 14).getValue()), "U1");
  });
  test("他の人が同じ受付番号を結びつけようとすると、担当者に連絡が行く", () => {
    const before = discordCalls(env).length;
    handle("U2", order.lineText);
    assert.ok(lastReply().indexOf("担当者から連絡します") >= 0);
    assert.ok(discordCalls(env).length > before);
    assert.strictEqual(String(sheet().getRange(2, 14).getValue()), "U1");
  });
  test("番号だけでは、他人の状況は見られない／本人は見られる", () => {
    handle("U2", "受付番号 " + order.receiptNo);
    assert.ok(lastReply().indexOf("確認コードが必要") >= 0);
    handle("U1", "受付番号 " + order.receiptNo);
    assert.ok(lastReply().indexOf("順番に対応") >= 0, lastReply());
  });
  test("「進捗」で今の状況が返る（AIは使わない）", () => {
    const n = aiCalls(env).length;
    handle("U1", "進捗");
    assert.ok(lastReply().indexOf("順番に対応") >= 0);
    assert.strictEqual(aiCalls(env).length, n);
  });
  test("LINE記録シートに、お客さん名と受付番号が入る", () => {
    const sh = env.sheets["LINE記録"];
    const row = sh.getRange(2, 1, 1, 6).getValues()[0];
    assert.strictEqual(row[1], "花子"); assert.strictEqual(row[4], order.receiptNo); assert.strictEqual(row[5], "U1");
  });

  test("管理者：パスワードが違うと何もできない", () => {
    assert.strictEqual(env.run("adminList")("bad").ok, false);
    assert.strictEqual(env.run("adminSetStatus")("bad", order.receiptNo, "代行中").ok, false);
    assert.strictEqual(env.run("workerList")("adminpw").ok, false); // 管理者のパスワードでは代行者ページに入れない
  });
  test("管理者：代行中にすると、代行者ページに出る（見えるのは最低限だけ）", () => {
    assert.strictEqual(env.run("workerList")("workerpw").list.length, 0);
    assert.strictEqual(env.run("adminSetStatus")("adminpw", order.receiptNo, "代行中").ok, true);
    const w = env.run("workerList")("workerpw");
    assert.strictEqual(w.list.length, 1);
    assert.deepStrictEqual(Object.keys(w.list[0]).sort(), ["account", "fixed", "menu", "no", "note"]);
    assert.ok(JSON.stringify(w).indexOf("花子") < 0 && JSON.stringify(w).indexOf("drive.example") < 0);
  });
  const TK = "abcdef1234567890abcdef1234567890";
  const status = () => env.run("normStatus")(sheet().getRange(2, 10).getValue());
  test("代行者：「ログインできない」→ お客さんのLINEに、入力し直し用のリンクが届く", () => {
    assert.strictEqual(env.run("workerLoginFail")("adminpw", order.receiptNo).ok, false); // 代行者のパスワードが必要
    const n = lineCalls(env, "push").length;
    assert.strictEqual(env.run("workerLoginFail")("workerpw", order.receiptNo).ok, true);
    assert.strictEqual(status(), "再入力待ち");
    const p = lineCalls(env, "push")[n];
    assert.strictEqual(p.body.to, "U1");
    const txt = p.body.messages[0].text;
    assert.ok(txt.indexOf("ログインできませんでした") >= 0 && txt.indexOf(order.receiptNo) >= 0, txt);
    assert.ok(txt.indexOf("?page=fix&no=" + encodeURIComponent(order.receiptNo) + "&t=" + TK) >= 0, txt);
    assert.strictEqual(env.run("workerList")("workerpw").list.length, 0, "再入力待ちの間は、代行者の一覧から消える");
    assert.strictEqual(env.run("workerLoginFail")("workerpw", order.receiptNo).ok, false, "二重には押せない");
  });
  test("再入力待ちの間：「進捗」やLINEに書いたパスワードには、入力し直し用リンクで答える（記録には残さない）", () => {
    handle("U1", "進捗");
    assert.ok(lastReply().indexOf("ログインできなかった") >= 0 && lastReply().indexOf("page=fix") >= 0, lastReply());
    handle("U1", "a@b.com newPass123");
    assert.ok(lastReply().indexOf("page=fix") >= 0 && lastReply().indexOf("送らないでください") >= 0, lastReply());
    assert.ok((JSON.stringify(env.sheets["LINE記録"]) + JSON.stringify(env.cacheStore)).indexOf("newPass123") < 0);
  });
  test("入力し直しページ：合言葉が違うと使えない／前のパスワードは見せない", () => {
    assert.strictEqual(env.run("fixInfo")(order.receiptNo, "wrong").ok, false);
    assert.strictEqual(env.run("fixInfo")(order.receiptNo, "").ok, false);
    assert.strictEqual(env.run("fixSubmit")(order.receiptNo, "wrong", "x@y.com:zz").ok, false);
    const info = env.run("fixInfo")(order.receiptNo, TK);
    assert.strictEqual(info.ok, true);
    assert.strictEqual(info.hint, "a***@b.com");
    assert.ok(JSON.stringify(info).indexOf("secretPW99") < 0);
    assert.strictEqual(env.run("fixSubmit")(order.receiptNo, TK, "  ").ok, false, "空は受け付けない");
  });
  test("入力し直すと、代行中に戻って代行者の一覧に「入力し直しました」付きで出る", () => {
    const d = discordCalls(env).length;
    assert.strictEqual(env.run("fixSubmit")(order.receiptNo, TK, "a@b.com:RightPW77").ok, true);
    assert.strictEqual(status(), "代行中");
    assert.strictEqual(sheet().getRange(2, 7).getValue(), "a@b.com:RightPW77");
    const w = env.run("workerList")("workerpw").list;
    assert.strictEqual(w.length, 1); assert.strictEqual(w[0].fixed, true); assert.strictEqual(w[0].account, "a@b.com:RightPW77");
    const note = discordCalls(env).slice(d).map(c => JSON.stringify(c.body)).join("");
    assert.ok(note.indexOf("入力し直されました") >= 0 && note.indexOf("RightPW77") < 0, "Discordにパスワードが載っている／通知がない");
    assert.strictEqual(env.run("fixSubmit")(order.receiptNo, TK, "x@y.com:again1").ok, false, "終わったリンクは使えない");
    assert.strictEqual(env.run("fixInfo")(order.receiptNo, TK).ok, false);
  });
  test("LINE未連携のお客さんの場合は、入力し直し用リンクをDiscordで管理者に渡す／管理ページにも出る", () => {
    const o2 = submit({ contact: "c@d.com:pw2", requester: "次郎" });
    env.run("adminSetStatus")("adminpw", o2.receiptNo, "代行中");
    const d = discordCalls(env).length;
    assert.strictEqual(env.run("workerLoginFail")("workerpw", o2.receiptNo).ok, true);
    const msg = discordCalls(env).slice(d).map(c => (c.body && c.body.content) || "").join("");
    assert.ok(msg.indexOf("LINE未連携") >= 0 && msg.indexOf("page=fix&no=" + encodeURIComponent(o2.receiptNo)) >= 0, msg);
    const det = env.run("adminDetail")("adminpw", o2.receiptNo);
    assert.ok(det.fixUrl.indexOf("page=fix") >= 0);
    assert.strictEqual(env.run("adminDetail")("adminpw", order.receiptNo).fixUrl, "", "再入力待ちでなければリンクは出さない");
    assert.strictEqual(env.run("adminStats")("adminpw").counts["再入力待ち"], 1);
    env.run("adminSetStatus")("adminpw", o2.receiptNo, "完了");
  });
  test("代行者：納品完了にすると、お客さんにLINEが届く", () => {
    const n = lineCalls(env, "push").length;
    assert.strictEqual(env.run("workerDeliver")("workerpw", order.receiptNo).ok, true);
    const pushes = lineCalls(env, "push");
    assert.strictEqual(pushes.length, n + 1);
    assert.strictEqual(pushes[n].body.to, "U1");
    assert.ok(pushes[n].body.messages[0].text.indexOf("納品しました") >= 0);
    assert.strictEqual(env.run("workerDeliver")("workerpw", order.receiptNo).ok, false); // 二重には押せない
  });
  test("納品後のまだ問題がありそうな返信では、完了にしない", () => {
    env.aiQueue.push({ text: JSON.stringify({ reply: "確認しますね。", need_staff: true, closing: false, summary: "反映されていない" }) });
    handle("U1", "ありがとう、でもまだ反映されてない");
    assert.strictEqual(env.run("normStatus")(sheet().getRange(2, 10).getValue()), "納品済");
  });
  test("納品後の「ありがとう」で、自動で完了＋Discordのメッセージが消える", () => {
    const before = discordCalls(env).filter(c => c.method === "delete").length;
    const n = aiCalls(env).length;
    handle("U1", "ありがとうございました！");
    assert.strictEqual(env.run("normStatus")(sheet().getRange(2, 10).getValue()), "完了");
    assert.ok(lastReply().indexOf("完了です") >= 0);
    assert.strictEqual(aiCalls(env).length, n, "ルールで察知できる場合はAIを使わない");
    assert.strictEqual(discordCalls(env).filter(c => c.method === "delete").length, before + 1);
  });
}

// ---------------- 4. AI・守り ----------------
{
  const env = makeEnv(BASE_PROPS);
  env.run("setup")();
  const handle = (uid, text) => { env.run("BOT_STATE").replied = false; env.run("handleTextMessage")(uid, "rt", text); };
  const lastReply = () => { const c = lineCalls(env, "reply"); return c.length ? c[c.length - 1].body.messages[0].text : ""; };
  const ai = (o) => env.aiQueue.push({ text: JSON.stringify(Object.assign({ reply: "OKです", need_staff: false, closing: false, summary: "要約" }, o)) });

  test("IDやパスワードは、AIに送らず・記録にも会話の記憶にも残さない", () => {
    handle("U9", "パスワードはabc12345XYZです");
    assert.strictEqual(aiCalls(env).length, 0);
    assert.ok(lastReply().indexOf("注文フォームから\nお送りください") >= 0, lastReply());
    const everything = JSON.stringify(env.sheets) + JSON.stringify(env.cacheStore) + JSON.stringify(discordCalls(env));
    assert.ok(everything.indexOf("abc12345XYZ") < 0, "どこかに残っている");
    handle("U9", "taro@example.com Pass9999zz");
    assert.ok((JSON.stringify(env.sheets) + JSON.stringify(env.cacheStore)).indexOf("Pass9999zz") < 0);
  });
  test("AIには、マニュアルとルールを渡し、会話は直近10往復までにする", () => {
    for (let i = 0; i < 14; i++) { ai({}); handle("U8", "質問その" + i); }
    const calls = aiCalls(env);
    const last = calls[calls.length - 1].body;
    assert.strictEqual(last.model, "claude-sonnet-5-5");
    assert.ok(last.system[0].text.indexOf("【マニュアル】") >= 0 && last.system[0].text.indexOf("コイン指定") >= 0);
    assert.ok(last.messages.length <= 21, "履歴が長すぎる: " + last.messages.length);
    assert.strictEqual(last.messages[0].role, "user");
    assert.strictEqual(last.messages[last.messages.length - 1].content, "質問その13");
    assert.strictEqual(calls[0].headers["x-api-key"], "KEY"); // キーは設定から読む
  });
  test("コードの中に、秘密の文字列が書かれていない", () => {
    const src = ["Code.gs", "Bot.gs", "Manual.gs", "FixedReplies.gs", "form.html", "admin.html", "worker.html"]
      .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
    assert.ok(!/discord(app)?\.com\/api\/webhooks\/\d/.test(src), "Discord URLが書かれている");
    assert.ok(!/sk-ant-/.test(src), "APIキーが書かれている");
    assert.ok(!/Bearer [A-Za-z0-9+\/=_-]{20,}/.test(src), "LINEトークンが書かれている");
  });
  test("マニュアルにないこと（AIが need_staff）→「担当者から連絡します」＋Discord通知＋記録", () => {
    const n = discordCalls(env).length;
    ai({ reply: "確認します。", need_staff: true, summary: "返金希望" });
    handle("U7", "返金してください");
    assert.ok(lastReply().indexOf("担当者から連絡します") >= 0);
    assert.ok(discordCalls(env).length > n);
    const row = env.sheets["LINE記録"].getRange(2, 1, env.sheets["LINE記録"].getLastRow() - 1, 6).getValues().find(r => r[5] === "U7");
    assert.strictEqual(row[3], "担当者待ち"); assert.strictEqual(row[2], "返金希望");
  });
  test("AIがエラーのときも、お客さんには「担当者から連絡します」と返し、担当者に知らせる", () => {
    const n = discordCalls(env).length;
    env.aiQueue.push({ error: 529 });
    handle("U6", "納期はいつですか");
    assert.ok(lastReply().indexOf("担当者から連絡します") >= 0);
    assert.ok(discordCalls(env).length > n);
  });
  test("AIがJSON以外を返しても、そのまま送らず担当者に回す", () => {
    env.aiQueue.push({ text: "どうぞご自由に（JSONではない文章）" });
    handle("U5", "どうなってますか");
    assert.ok(lastReply().indexOf("担当者から連絡します") >= 0);
    assert.ok(lastReply().indexOf("ご自由に") < 0);
  });
  test("AIが長い1行で返事しても、お客さんには改行し直して届く", () => {
    ai({ reply: "ご連絡ありがとうございます。どのようなご用件でしょうか？ご注文はメニューの「注文」から注文フォームをご利用ください。", summary: "用件" });
    handle("U12", "こんにちは");
    const r = lastReply();
    assert.ok(r.split("\n").length >= 4, "改行されていない: " + r);
    assert.strictEqual(r.replace(/\n/g, ""), "ご連絡ありがとうございます。どのようなご用件でしょうか？ご注文はメニューの「注文」から注文フォームをご利用ください。");
  });
  test("納品前の「ありがとう」では完了にしない（AIを使わず定型で返す）", () => {
    const n = aiCalls(env).length;
    handle("U3", "ありがとう");
    assert.strictEqual(aiCalls(env).length, n);
    assert.ok(lastReply().indexOf("こちらこそ") >= 0, lastReply());
    assert.ok(lastReply().indexOf("完了です") < 0);
  });
  test("担当者待ちの間は、ボットがAIで返事をせず、担当者に知らせる／対応済にすると再開する", () => {
    const n = aiCalls(env).length, d = discordCalls(env).length;
    handle("U7", "いつ連絡もらえますか"); // U7 は上のテストで「担当者待ち」になっている
    assert.strictEqual(aiCalls(env).length, n, "担当者待ちなのにAIを呼んだ");
    assert.ok(lastReply().indexOf("担当者が確認中") >= 0, lastReply());
    assert.ok(discordCalls(env).length > d, "担当者に知らせていない");
    assert.ok(discordCalls(env).pop().body.content.indexOf("いつ連絡もらえますか") >= 0);
    handle("U7", "料金"); // 決まった返事は、担当者待ちでも返る
    assert.ok(lastReply().indexOf("料金表") >= 0);

    const inq = env.run("adminInquiries")("adminpw");
    assert.ok(inq.ok && inq.list.some(q => q.uid === "U7" && q.summary === "返金希望"), JSON.stringify(inq));
    assert.strictEqual(env.run("adminInquiries")("bad").ok, false);
    assert.strictEqual(env.run("adminResolveInquiry")("bad", "U7").ok, false);
    const p = lineCalls(env, "push").length;
    assert.strictEqual(env.run("adminSendLineInquiry")("adminpw", "U7", "確認しました、返金します").ok, true);
    assert.strictEqual(lineCalls(env, "push")[p].body.to, "U7");
    assert.strictEqual(env.run("adminResolveInquiry")("adminpw", "U7").ok, true);
    assert.ok(!env.run("adminInquiries")("adminpw").list.some(q => q.uid === "U7"));

    ai({ reply: "はい、承ります。", summary: "再開" });
    handle("U7", "別の質問です");
    assert.strictEqual(aiCalls(env).length, n + 1, "対応済にしたのにAIが再開しない");
    assert.ok(lastReply().indexOf("承ります") >= 0);
  });
  test("AIの使いすぎを止める（1人1時間30回まで）", () => {
    const n = aiCalls(env).length;
    for (let i = 0; i < 30; i++) { ai({}); handle("U2", "質問" + i); }
    assert.strictEqual(aiCalls(env).length, n + 30);
    handle("U2", "質問31");
    assert.strictEqual(aiCalls(env).length, n + 30, "上限を超えてもAIを呼んだ");
    assert.ok(lastReply().indexOf("混み合って") >= 0, lastReply());
    handle("U2", "料金"); // 決まった返事は使える
    assert.ok(lastReply().indexOf("料金表") >= 0);
  });
  test("Discordの通知に、お客さんの文章の@が入っても、全員宛メンションにならない", () => {
    env.aiQueue.push({ error: 500 });
    handle("U4", "@everyone 助けて");
    const last = discordCalls(env).filter(c => c.body && c.body.content).pop();
    assert.ok(last.body.content.indexOf("@everyone") < 0);
  });
}

// ---------------- 5. LINEからの入口 ----------------
{
  const mk = (extra) => makeEnv(Object.assign({}, BASE_PROPS, extra || {}));
  const post = (env, key, events) => env.run("doPost")({ parameter: key === null ? {} : { key }, postData: { contents: JSON.stringify({ events }) } });
  const msg = (uid, text, id) => ({ type: "message", replyToken: "rt", webhookEventId: id, source: { type: "user", userId: uid }, message: { type: "text", id, text } });

  test("合言葉（?key=）が違うと、何も処理しない", () => {
    const env = mk(); env.run("setup")();
    post(env, "wrong", [msg("U1", "料金", "e1")]); post(env, null, [msg("U1", "料金", "e2")]);
    assert.strictEqual(lineCalls(env, "reply").length, 0);
  });
  test("合言葉が合えば返信する／LINEの「検証」（空の通知）も通る／同じ通知は2回処理しない", () => {
    const env = mk(); env.run("setup")();
    assert.strictEqual(post(env, "secretkey", []).text, "OK");
    post(env, "secretkey", [msg("U1", "料金", "e3")]);
    post(env, "secretkey", [msg("U1", "料金", "e3")]);
    assert.strictEqual(lineCalls(env, "reply").length, 1);
    assert.ok(lineCalls(env, "reply")[0].body.messages[0].text.indexOf("料金表") >= 0);
    assert.strictEqual(lineCalls(env, "reply")[0].headers.Authorization, "Bearer TOKEN");
  });
  test("テストモード：自分以外には返事しない／「ID確認」でIDを教える", () => {
    const env = mk({ TEST_MODE: "on", TEST_USER_ID: "Umine" }); env.run("setup")();
    post(env, "secretkey", [msg("Uother", "料金", "e4")]);
    assert.strictEqual(lineCalls(env, "reply").length, 0);
    post(env, "secretkey", [msg("Uother", "ID確認", "e5")]);
    assert.ok(lineCalls(env, "reply")[0].body.messages[0].text.indexOf("Uother") >= 0);
    post(env, "secretkey", [msg("Umine", "料金", "e6")]);
    assert.strictEqual(lineCalls(env, "reply").length, 2);
  });
  test("テストモードは「ON」「オン」「 on 」など、書き方の違いがあっても効く", () => {
    ["ON", "オン", " on ", "ｏｎ"].forEach(v => {
      const env = mk({ TEST_MODE: v, TEST_USER_ID: " Umine " }); env.run("setup")();
      post(env, "secretkey", [msg("Uother", "はい", "x" + v)]);
      assert.strictEqual(lineCalls(env, "reply").length, 0, "他人に返事した: " + JSON.stringify(v));
      post(env, "secretkey", [msg("Umine", "料金", "y" + v)]);
      assert.strictEqual(lineCalls(env, "reply").length, 1, "自分に返事しない: " + JSON.stringify(v));
      env.run("checkSecrets")();
      assert.ok(env.logs.join("\n").indexOf("【テストモード】") >= 0);
    });
    const env = mk(); env.run("checkSecrets")();
    assert.ok(env.logs.join("\n").indexOf("【本番モード】") >= 0);
  });
  test("本番モードでは「ID確認」は特別扱いしない", () => {
    const env = mk(); env.run("setup")();
    env.aiQueue.push({ text: JSON.stringify({ reply: "はい", need_staff: false, closing: false, summary: "x" }) });
    post(env, "secretkey", [msg("U1", "ID確認", "e7")]);
    assert.ok(lineCalls(env, "reply")[0].body.messages[0].text.indexOf("あなたのID") < 0);
  });
  test("スタンプは無視／画像は担当者に知らせる", () => {
    const env = mk(); env.run("setup")();
    post(env, "secretkey", [{ type: "message", replyToken: "r", webhookEventId: "s1", source: { type: "user", userId: "U1" }, message: { type: "sticker", id: "s1" } }]);
    assert.strictEqual(lineCalls(env, "reply").length, 0);
    post(env, "secretkey", [{ type: "message", replyToken: "r", webhookEventId: "i1", source: { type: "user", userId: "U1" }, message: { type: "image", id: "i1" } }]);
    assert.strictEqual(lineCalls(env, "reply").length, 1);
    assert.ok(discordCalls(env).length >= 1);
  });
  test("グループなど、1対1以外のトークは無視する", () => {
    const env = mk(); env.run("setup")();
    post(env, "secretkey", [{ type: "message", replyToken: "r", webhookEventId: "g1", source: { type: "group", userId: "U1", groupId: "G" }, message: { type: "text", id: "g1", text: "料金" } }]);
    assert.strictEqual(lineCalls(env, "reply").length, 0);
  });
  test("APP_URL を設定すると、リンクにそのURLを使う", () => {
    const env = mk({ APP_URL: "https://script.google.com/macros/s/REAL/exec" });
    assert.strictEqual(env.run("appUrl")(), "https://script.google.com/macros/s/REAL/exec");
    assert.strictEqual(mk().run("appUrl")(), "https://script.google.com/macros/s/TEST/exec");
  });
  test("checkSecrets：足りない設定を教える（中身は表示しない）", () => {
    const env = makeEnv({ LINE_TOKEN: "SECRETVALUE" });
    env.run("checkSecrets")();
    const log = env.logs.join("\n");
    assert.ok(log.indexOf("未設定 CLAUDE_API_KEY") >= 0 && log.indexOf("OK    LINE_TOKEN") >= 0);
    assert.ok(log.indexOf("未設定 LINE_BASIC_ID") >= 0, "LINE_BASIC_ID がないとボタンが出ないので必須");
    assert.ok(log.indexOf("SECRETVALUE") < 0);
  });
}

// ---------------- 6. スマホでの見え方 ----------------
test("ボットが送る文章は、どの行もスマホの吹き出しに収まる（全角14文字ぶんまで）", () => {
  const width = (line) => { // Bot.gs とは別に、ここで独立して計算する
    const cs = Array.from(line); let w = 0;
    cs.forEach((ch, i) => {
      const c = ch.codePointAt(0);
      if (c === 0xFE0F || c === 0x200D) return;
      if (c === 0x20E3) return;
      if (cs[i + 1] === "\uFE0F" || c >= 0x1F000 || (c >= 0x2300 && c <= 0x23FF) || (c >= 0x2600 && c <= 0x27BF) || (c >= 0x2B00 && c <= 0x2BFF)) { w += 2; return; }
      w += (c < 0x80 || (c >= 0xFF61 && c <= 0xFF9F)) ? 0.5 : 1;
    });
    return w;
  };
  const env = makeEnv(BASE_PROPS);
  const fixedTexts = Object.keys(env.run("FIXED_REPLIES")).map(k => env.run("matchFixedReply")(k)).filter(Boolean);
  const texts = ALL_LINE_TEXTS.concat(fixedTexts);
  assert.ok(texts.length > 30, "調べる文章が少なすぎる: " + texts.length);
  const bad = [];
  texts.forEach(t => t.split("\n").forEach(l => {
    if (/https?:/.test(l) || /^U[0-9a-z]+$/i.test(l)) return; // URLとIDは切れないので除く
    if (width(l) > 14) bad.push(l + "（" + width(l) + "）");
  }));
  assert.deepStrictEqual(Array.from(new Set(bad)), []);
});

console.log("\n" + results.join("\n"));
console.log("\n" + passed + " 件OK / " + (results.length - passed) + " 件NG");
