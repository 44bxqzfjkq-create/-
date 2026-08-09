"""HTML レポート生成 (L5)。閲覧性重視のダッシュボード的個別レポート。"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Any

from ..engine import AnalysisBundle


def _num(v: Any, unit: str = "", nd: int = 1) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.{nd}f}{unit}"
    return f"{v}{unit}"


def _esc(s: str) -> str:
    return html.escape(str(s))


_CSS = """
:root{--bg:#f1f4f2;--surface:#fff;--ink:#15211d;--ink2:#4a544f;--ink3:#6c7975;
--border:#dbe2de;--accent:#0f6e5c;--good:#1e7a4e;--warn:#9c6712;--crit:#a83a3a;}
@media(prefers-color-scheme:dark){:root{--bg:#0d1512;--surface:#16201c;--ink:#e7ece9;
--ink2:#aebab4;--ink3:#7f8d87;--border:#273531;--accent:#4fc0a4;
--good:#5cbe86;--warn:#d6a24e;--crit:#de7d7d;}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif;line-height:1.7}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:26px;margin:0 0 6px}.sub{color:var(--ink3);font-size:14px;margin-bottom:20px}
.banner{border-radius:10px;padding:12px 16px;margin:12px 0;font-size:14px}
.banner.warn{background:#f6ebd5;border-left:3px solid var(--warn);color:#5a4410}
.banner.info{background:var(--surface);border:1px solid var(--border);color:var(--ink2)}
@media(prefers-color-scheme:dark){.banner.warn{background:#33280f;color:#e8cf9a}}
.hero{display:flex;gap:24px;align-items:center;background:var(--surface);border:1px solid var(--border);
border-radius:16px;padding:24px;margin:16px 0;flex-wrap:wrap}
.gauge{--v:0;width:120px;height:120px;border-radius:50%;flex:none;
background:conic-gradient(var(--accent) calc(var(--v)*1%),var(--border) 0);
display:grid;place-items:center}
.gauge .inner{width:92px;height:92px;border-radius:50%;background:var(--surface);display:grid;place-items:center;text-align:center}
.gauge .val{font-size:30px;font-weight:700}.gauge .lbl{font-size:11px;color:var(--ink3)}
.hero .meta{flex:1;min-width:220px}.rating{display:inline-block;padding:4px 12px;border-radius:999px;
background:var(--accent);color:#fff;font-size:13px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin:14px 0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px}
.card.alert{border-left:3px solid var(--crit)}
.card h3{margin:0 0 4px;font-size:15px;display:flex;justify-content:space-between;align-items:center}
.badge{font-size:12px;font-weight:700;color:var(--accent)}.badge.hold{color:var(--ink3)}
.card ul{margin:8px 0 0;padding-left:18px;font-size:13.5px;color:var(--ink2)}
.card .flags{margin-top:8px;font-size:12px;color:var(--crit)}
h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid var(--border);padding-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--border)}
th{background:rgba(15,110,92,.07)}td.v{text-align:right;font-variant-numeric:tabular-nums}
.prov{font-size:12.5px;color:var(--ink3)}.foot{margin-top:30px;color:var(--ink3);font-size:12px}
"""


def render_analysis(bundle: AnalysisBundle) -> str:
    d = bundle.data
    c = d.company
    sc = bundle.scoring
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    score = sc["score"]
    score_v = 0 if score is None else round(score)

    parts = [f"<!doctype html><html lang='ja'><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width,initial-scale=1'>",
             f"<title>{_esc(c.code)} {_esc(c.name)} 分析レポート</title>",
             f"<style>{_CSS}</style></head><body><div class='wrap'>"]
    parts.append(f"<h1>{_esc(c.code)} {_esc(c.name)}</h1>")
    parts.append(f"<div class='sub'>{_esc(c.sector or '')} ｜ 総合分析レポート ｜ {now}</div>")

    if d.is_synthetic:
        parts.append("<div class='banner warn'>⚠ <b>サンプル(合成)データによる出力です。実際の市場データではありません。</b>"
                     " 実データは設定の provider を yfinance に切り替えてください。</div>")
    parts.append("<div class='banner info'>本レポートは分析材料の整理を目的とし、投資助言・売買推奨ではありません。"
                 "スコアは「注目度」であり「買い推奨」ではありません。</div>")

    # hero gauge
    pen = f"<div style='color:var(--warn);font-size:12px'>{_esc('、'.join(sc['penalties']))}</div>" if sc["penalties"] else ""
    held = f"<div style='color:var(--ink3);font-size:12px'>判定保留: {_esc('、'.join(sc['modules_held']))}</div>" if sc["modules_held"] else ""
    parts.append(
        f"<div class='hero'><div class='gauge' style='--v:{score_v}'>"
        f"<div class='inner'><div><div class='val'>{_num(score,nd=0)}</div>"
        f"<div class='lbl'>/ 100</div></div></div></div>"
        f"<div class='meta'><span class='rating'>{_esc(sc['rating'])}</span>"
        f"<div style='margin-top:10px'>株価 {_num(bundle.indicators.get('price'),'円',0)}</div>"
        f"{pen}{held}</div></div>"
    )

    rmap = {r.module: r for r in bundle.results}

    # 反証・リスク先出し
    parts.append("<h2>⚠ 反証・リスク（結論の前に）</h2><div class='grid'>")
    for mod in ("counter_analysis", "risk"):
        r = rmap.get(mod)
        if not r:
            continue
        items = "".join(f"<li>{_esc(f)}</li>" for f in r.findings)
        parts.append(f"<div class='card alert'><h3>{_esc(r.title)}</h3><ul>{items}</ul></div>")
    parts.append("</div>")

    # モジュール
    parts.append("<h2>モジュール別 分析</h2><div class='grid'>")
    order = ["performance", "earnings", "financials", "valuation", "growth",
             "price_action", "market_expectation", "hypothesis", "investor_views"]
    for mod in order:
        r = rmap.get(mod)
        if not r:
            continue
        badge = "<span class='badge hold'>判定保留</span>" if r.score is None else f"<span class='badge'>{r.score:.0f}/100</span>"
        items = "".join(f"<li>{_esc(f)}</li>" for f in r.findings)
        flags = f"<div class='flags'>🚩 {_esc('、'.join(r.flags))}</div>" if r.flags else ""
        parts.append(f"<div class='card'><h3>{_esc(r.title)}{badge}</h3><ul>{items}</ul>{flags}</div>")
    parts.append("</div>")

    # 指標表
    im = bundle.indicators
    rows = [("PER", _num(im.get("per"), "倍")), ("PBR", _num(im.get("pbr"), "倍")),
            ("配当利回り", _num(im.get("dividend_yield"), "%")),
            ("ROE", _num(im.get("roe"), "%")), ("ROA", _num(im.get("roa"), "%")),
            ("営業利益率", _num(im.get("operating_margin"), "%")),
            ("自己資本比率", _num(im.get("equity_ratio"), "%")),
            ("売上成長(YoY)", _num(im.get("revenue_growth_yoy"), "%")),
            ("売上CAGR(3年)", _num(im.get("revenue_cagr_3y"), "%")),
            ("6か月リターン", _num(im.get("return_6m"), "%")),
            ("年率ボラティリティ", _num(im.get("volatility_annual"), "%"))]
    parts.append("<h2>主要指標</h2><table><tr><th>指標</th><th style='text-align:right'>値</th></tr>")
    for k, v in rows:
        parts.append(f"<tr><td>{_esc(k)}</td><td class='v'>{_esc(v)}</td></tr>")
    parts.append("</table>")

    # 出典
    parts.append("<h2>データ出典 (Provenance)</h2><div class='prov'>")
    for p in d.provenance:
        parts.append(f"<div>• {_esc(p.one_line())}</div>")
    parts.append("</div>")

    parts.append(f"<div class='foot'>生成: {now} ／ stocksys v0.1</div>")
    parts.append("</div></body></html>")
    return "".join(parts)
