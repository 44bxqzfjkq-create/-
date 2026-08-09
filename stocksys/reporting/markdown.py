"""Markdown レポート生成 (L5)。個別分析・比較の一次成果物。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..engine import AnalysisBundle


def _num(v: Any, unit: str = "", nd: int = 1) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.{nd}f}{unit}"
    return f"{v}{unit}"


def _disclaimer(synthetic: bool) -> str:
    lines = []
    if synthetic:
        lines.append("> ⚠ **サンプル(合成)データによる出力です。実際の市場データではありません。**  ")
        lines.append("> 実データで動かすには設定の `provider` を `yfinance` に切り替えてください。\n")
    lines.append("> **免責:** 本レポートは分析材料の整理を目的とし、投資助言・売買推奨ではありません。"
                 "最終的な投資判断はご自身の責任で行ってください。")
    return "\n".join(lines)


def render_analysis(bundle: AnalysisBundle) -> str:
    d = bundle.data
    c = d.company
    sc = bundle.scoring
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")

    out: list[str] = []
    out.append(f"# {c.code} {c.name} — 総合分析レポート\n")
    out.append(_disclaimer(d.is_synthetic))
    out.append("")

    # サマリー
    out.append("## サマリー\n")
    out.append(f"- **総合スコア:** {_num(sc['score'], nd=1)} / 100 　（**{sc['rating']}**）")
    out.append(f"- **業種:** {c.sector or '—'}　**株価:** {_num(bundle.indicators.get('price'),'円',0)}")
    if sc["penalties"]:
        out.append(f"- **ペナルティ:** {', '.join(sc['penalties'])}")
    if sc["modules_held"]:
        out.append(f"- **判定保留モジュール:** {', '.join(sc['modules_held'])}（データ不足）")
    out.append("")
    out.append("> スコアは「注目度」であり「買い推奨」ではありません。"
               "以下の反証・リスクを必ず併せてご確認ください。\n")

    # 反証・リスクを結論の前に（設計原則）
    for mod in ("counter_analysis", "risk"):
        r = next((x for x in bundle.results if x.module == mod), None)
        if r:
            out.append(f"## ⚠ {r.title}\n")
            for f in r.findings:
                out.append(f"- {f}")
            out.append("")

    # 各モジュール
    out.append("## モジュール別 分析\n")
    order = ["performance", "earnings", "financials", "valuation", "growth",
             "price_action", "market_expectation", "hypothesis", "investor_views"]
    rmap = {r.module: r for r in bundle.results}
    for mod in order:
        r = rmap.get(mod)
        if not r:
            continue
        score_txt = "判定保留" if r.score is None else f"{r.score:.0f}/100"
        out.append(f"### {r.title} — {score_txt}\n")
        for f in r.findings:
            out.append(f"- {f}")
        if r.flags:
            out.append(f"- 🚩 注意: {', '.join(r.flags)}")
        out.append("")

    # 主要指標表
    out.append("## 主要指標\n")
    im = bundle.indicators
    rows = [
        ("PER", _num(im.get("per"), "倍")), ("PBR", _num(im.get("pbr"), "倍")),
        ("配当利回り", _num(im.get("dividend_yield"), "%")),
        ("ROE", _num(im.get("roe"), "%")), ("ROA", _num(im.get("roa"), "%")),
        ("営業利益率", _num(im.get("operating_margin"), "%")),
        ("自己資本比率", _num(im.get("equity_ratio"), "%")),
        ("売上成長(YoY)", _num(im.get("revenue_growth_yoy"), "%")),
        ("売上CAGR(3年)", _num(im.get("revenue_cagr_3y"), "%")),
        ("6か月リターン", _num(im.get("return_6m"), "%")),
        ("年率ボラティリティ", _num(im.get("volatility_annual"), "%")),
    ]
    out.append("| 指標 | 値 |")
    out.append("|------|----|")
    for k, v in rows:
        out.append(f"| {k} | {v} |")
    out.append("")

    # 出典
    out.append("## データ出典 (Provenance)\n")
    for p in d.provenance:
        out.append(f"- {p.one_line()}")
        if p.notes:
            out.append(f"  - 備考: {p.notes}")
    out.append("")
    out.append(f"---\n*生成日時: {now} ／ stocksys v0.1 ／ provider={d.provenance[0].source if d.provenance else '—'}*")
    return "\n".join(out)


def render_screening(preset_label: str, ranked: list[dict], provider: str,
                     synthetic: bool) -> str:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    out = [f"# スクリーニング結果 — {preset_label}\n"]
    out.append(_disclaimer(synthetic))
    out.append("")
    passed = [r for r in ranked if r["screen"]["passed"]]
    out.append(f"- 対象 {len(ranked)} 銘柄中、条件通過 **{len(passed)}** 銘柄\n")

    out.append("## 通過銘柄（総合スコア順）\n")
    out.append("| 順位 | コード | 銘柄 | 総合 | PER | ROE | 自己資本比率 | 売上成長 |")
    out.append("|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(passed, 1):
        m = r["metrics"]
        out.append(f"| {i} | {r['code']} | {r['name']} | {_num(r['total'],nd=0)} | "
                   f"{_num(m.get('per'),'倍')} | {_num(m.get('roe'),'%')} | "
                   f"{_num(m.get('equity_ratio'),'%')} | {_num(m.get('revenue_growth_yoy'),'%')} |")
    if not passed:
        out.append("| — | — | 条件を満たす銘柄なし | — | — | — | — | — |")
    out.append("")

    out.append("## 非通過の内訳\n")
    for r in ranked:
        if r["screen"]["passed"]:
            continue
        s = r["screen"]
        reason = []
        if s["failed_rules"]:
            reason.append("未達: " + ", ".join(s["failed_rules"]))
        if s["unknown_rules"]:
            reason.append("データ無: " + ", ".join(s["unknown_rules"]))
        if s["excluded_by"]:
            reason.append("除外: " + ", ".join(s["excluded_by"]))
        out.append(f"- **{r['code']} {r['name']}** — " + " / ".join(reason))
    out.append("")
    out.append(f"---\n*生成日時: {now} ／ stocksys v0.1 ／ provider={provider}*")
    return "\n".join(out)


def render_comparison(comp: dict, provider: str, synthetic: bool) -> str:
    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")
    out = ["# 企業比較レポート\n"]
    out.append(_disclaimer(synthetic))
    out.append("")
    for w in comp["warnings"]:
        out.append(f"> ⚠ {w}\n")

    rows = comp["rows"]
    header = "| 指標 | " + " | ".join(f"{r['code']} {r['name']}" for r in rows) + " |"
    out.append(header)
    out.append("|---" * (len(rows) + 1) + "|")
    # 総合スコア行
    out.append("| **総合スコア** | " +
               " | ".join(_num(r["total"], nd=0) for r in rows) + " |")
    for label, key, unit, higher in comp["fields"]:
        cells = []
        for r in rows:
            v = r["metrics"].get(key)
            txt = _num(v, unit)
            if comp["best"].get(key) == r["code"] and v is not None:
                txt = f"**{txt}** ✅"
            cells.append(txt)
        out.append(f"| {label} | " + " | ".join(cells) + " |")
    out.append("")
    out.append("*✅ = 比較対象内での最良値（業種差に注意）*")
    out.append("")
    out.append(f"---\n*生成日時: {now} ／ stocksys v0.1 ／ provider={provider}*")
    return "\n".join(out)
