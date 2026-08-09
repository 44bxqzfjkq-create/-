"""分析エンジン (L3) — 既存11方針を11モジュールとして実装。

各モジュールは (StockData, 指標辞書) を受け取り、AnalysisResult を返す。
score は 0〜100（データ不足なら None=判定保留）。findings は根拠つき所見。
"""

from __future__ import annotations

from typing import Any, Callable

from ..indicators import score_linear
from ..models import AnalysisResult, StockData


def _fmt(v: Any, unit: str = "", nd: int = 1) -> str:
    if v is None:
        return "—"
    if isinstance(v, (int, float)):
        return f"{v:,.{nd}f}{unit}"
    return str(v)


def _avg(scores: list) -> Any:
    vals = [s for s in scores if s is not None]
    return sum(vals) / len(vals) if vals else None


# ---------------------------------------------------------------------------
# 1. 業績分析
# ---------------------------------------------------------------------------
def performance(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    s_margin = score_linear(m.get("operating_margin"), 2, 20)
    s_growth = score_linear(m.get("revenue_growth_yoy"), -5, 20)
    s_net = score_linear(m.get("net_margin"), 1, 15)
    score = _avg([s_margin, s_growth, s_net])

    om = m.get("operating_margin")
    if om is not None:
        findings.append(f"営業利益率は {_fmt(om, '%')}。" +
                        ("収益性は高水準。" if om >= 12 else
                         "平均的な水準。" if om >= 6 else "利益率は低め、要因確認。"))
    rg = m.get("revenue_growth_yoy")
    if rg is not None:
        findings.append(f"売上は前年比 {_fmt(rg, '%')}。" +
                        ("増収基調。" if rg > 0 else "減収、背景の確認が必要。"))
        if rg < 0:
            flags.append("減収")
    return AnalysisResult("performance", "業績分析", score,
                          {"営業利益率": om, "純利益率": m.get("net_margin"),
                           "売上前年比": rg}, findings, flags)


# ---------------------------------------------------------------------------
# 2. 決算分析
# ---------------------------------------------------------------------------
def earnings(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    fin = data.financials or {}
    plan = fin.get("company_plan") or {}
    score_parts = []

    ni_growth = m.get("net_income_growth_yoy")
    score_parts.append(score_linear(ni_growth, -10, 25))
    if ni_growth is not None:
        findings.append(f"純利益は前年同期比 {_fmt(ni_growth, '%')}。")
        if ni_growth < 0:
            flags.append("減益")

    progress = plan.get("progress_rate")
    if progress is not None:
        score_parts.append(score_linear(progress, 15, 60))  # 通期計画への進捗
        findings.append(f"会社計画に対する進捗率は {_fmt(progress, '%')}。" +
                        ("順調。" if progress >= 30 else "季節性を考慮しつつ注視。"))
    else:
        flags.append("会社計画データなし（決算モジュールは限定的）")

    surprise = plan.get("vs_consensus")
    if surprise is not None:
        score_parts.append(score_linear(surprise, -10, 10))
        findings.append(f"市場コンセンサス比 {_fmt(surprise, '%')}（+はサプライズ）。")

    score = _avg(score_parts)
    if not findings:
        findings.append("決算の詳細データが不足しているため判定を保留。")
    return AnalysisResult("earnings", "決算分析", score,
                          {"純利益前年比": ni_growth,
                           "計画進捗率": progress, "コンセンサス比": surprise},
                          findings, flags)


# ---------------------------------------------------------------------------
# 3. 財務分析
# ---------------------------------------------------------------------------
def financials(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    s_eq = score_linear(m.get("equity_ratio"), 20, 70)
    s_roe = score_linear(m.get("roe"), 4, 18)
    s_de = score_linear(m.get("debt_to_equity"), 0, 2, reverse=True)
    score = _avg([s_eq, s_roe, s_de])

    er = m.get("equity_ratio")
    if er is not None:
        findings.append(f"自己資本比率は {_fmt(er, '%')}。" +
                        ("財務は健全。" if er >= 50 else "標準的。" if er >= 30 else "やや低め、負債構成を確認。"))
        if er < 20:
            flags.append("自己資本比率が低い")
    roe = m.get("roe")
    if roe is not None:
        findings.append(f"ROE は {_fmt(roe, '%')}。" +
                        ("資本効率は良好。" if roe >= 12 else "平均的。" if roe >= 8 else "資本効率は低め。"))
    fcf = m.get("free_cf")
    if fcf is not None:
        findings.append(f"フリーCFは {_fmt(fcf, '', 0)}。" +
                        ("プラスで手元資金を生成。" if fcf > 0 else "マイナス、投資局面か要確認。"))
        if fcf < 0:
            flags.append("フリーCFがマイナス")
    return AnalysisResult("financials", "財務分析", score,
                          {"自己資本比率": er, "ROE": roe, "ROA": m.get("roa"),
                           "D/Eレシオ": m.get("debt_to_equity"), "フリーCF": fcf},
                          findings, flags)


# ---------------------------------------------------------------------------
# 4. バリュエーション分析
# ---------------------------------------------------------------------------
def valuation(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    s_per = score_linear(m.get("per"), 8, 35, reverse=True)
    s_pbr = score_linear(m.get("pbr"), 0.7, 4.0, reverse=True)
    s_dy = score_linear(m.get("dividend_yield"), 0.5, 4.0)
    score = _avg([s_per, s_pbr, s_dy])

    per, pbr, dy = m.get("per"), m.get("pbr"), m.get("dividend_yield")
    if per is not None:
        findings.append(f"PER {_fmt(per, '倍')}。" +
                        ("割安圏。" if per <= 12 else "妥当圏。" if per <= 22 else "やや割高、成長期待を織り込み。"))
    if pbr is not None:
        findings.append(f"PBR {_fmt(pbr, '倍')}。" + ("1倍割れで資産面は割安。" if pbr < 1 else ""))
    if dy is not None:
        findings.append(f"配当利回り {_fmt(dy, '%')}。")
    if per is not None and per > 40:
        flags.append("高PER（期待先行）")
    if not findings:
        findings.append("バリュエーション指標が不足のため判定を保留。")
    return AnalysisResult("valuation", "バリュエーション分析", score,
                          {"PER": per, "PBR": pbr, "配当利回り": dy, "PEG": m.get("peg")},
                          findings, flags)


# ---------------------------------------------------------------------------
# 5. 成長性分析
# ---------------------------------------------------------------------------
def growth(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    s_rev = score_linear(m.get("revenue_cagr_3y") or m.get("revenue_growth_yoy"), 0, 20)
    s_ni = score_linear(m.get("net_income_cagr_3y") or m.get("net_income_growth_yoy"), 0, 25)
    score = _avg([s_rev, s_ni])

    rc = m.get("revenue_cagr_3y")
    nc = m.get("net_income_cagr_3y")
    if rc is not None:
        findings.append(f"売上3年CAGRは {_fmt(rc, '%')}。" +
                        ("高成長。" if rc >= 10 else "緩やかな成長。" if rc >= 3 else "成長は限定的。"))
    if nc is not None:
        findings.append(f"純利益3年CAGRは {_fmt(nc, '%')}。")
        if rc is not None and nc is not None and nc > rc + 5:
            findings.append("利益成長が売上成長を上回り、利益率改善の可能性。")
    if rc is None and nc is None:
        findings.append("複数年の履歴が不足のため、成長性は前年比で暫定評価。")
        flags.append("成長トレンドの履歴不足")
    return AnalysisResult("growth", "成長性分析", score,
                          {"売上CAGR(3年)": rc, "純利益CAGR(3年)": nc},
                          findings, flags)


# ---------------------------------------------------------------------------
# 6. 株価分析
# ---------------------------------------------------------------------------
def price_action(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    price, sma25, sma75, sma200 = m.get("price"), m.get("sma25"), m.get("sma75"), m.get("sma200")
    parts = []
    if price and sma75:
        parts.append(80.0 if price > sma75 else 30.0)
        findings.append(f"株価 {_fmt(price, '円', 0)} は75日移動平均 {_fmt(sma75, '円', 0)} を" +
                        ("上回る（上昇基調）。" if price > sma75 else "下回る（調整局面）。"))
    if price and sma200:
        parts.append(75.0 if price > sma200 else 35.0)
    r6 = m.get("return_6m")
    if r6 is not None:
        parts.append(score_linear(r6, -20, 30))
        findings.append(f"直近6か月リターンは {_fmt(r6, '%')}。")
    pfh = m.get("pct_from_high")
    if pfh is not None:
        findings.append(f"52週高値からの位置は {_fmt(pfh, '%')}。")
    vol = m.get("volatility_annual")
    if vol is not None:
        findings.append(f"年率ボラティリティは {_fmt(vol, '%')}。")
        if vol > 45:
            flags.append("高ボラティリティ")
    score = _avg(parts)
    if not findings:
        findings.append("価格系列が不足のため判定を保留。")
    return AnalysisResult("price_action", "株価分析", score,
                          {"株価": price, "SMA75": sma75, "SMA200": sma200,
                           "6か月リターン": r6, "年率ボラ": vol}, findings, flags)


# ---------------------------------------------------------------------------
# 7. 市場期待との比較
# ---------------------------------------------------------------------------
def market_expectation(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    upside = m.get("upside_to_target")
    tp = m.get("target_price")
    if upside is None:
        findings.append("アナリスト目標株価/コンセンサスのデータが無いため判定を保留。")
        flags.append("市場期待データなし（有料コンセンサス導入で解消）")
        return AnalysisResult("market_expectation", "市場期待との比較", None,
                              {"目標株価": tp, "上値余地": None}, findings, flags)
    score = score_linear(upside, -20, 40)
    findings.append(f"アナリスト目標株価 {_fmt(tp, '円', 0)} に対する上値余地は {_fmt(upside, '%')}。" +
                    ("市場は上値を見込む。" if upside > 10 else
                     "概ね織り込み済み。" if upside > -5 else "目標株価を上回っており慎重。"))
    return AnalysisResult("market_expectation", "市場期待との比較", score,
                          {"目標株価": tp, "上値余地": upside}, findings, flags)


# ---------------------------------------------------------------------------
# 8. 投資仮説の作成
# ---------------------------------------------------------------------------
def hypothesis(data: StockData, m: dict) -> AnalysisResult:
    findings = []
    drivers = []
    if (m.get("revenue_cagr_3y") or 0) >= 8 or (m.get("revenue_growth_yoy") or 0) >= 8:
        drivers.append("トップライン成長の継続")
    if (m.get("operating_margin") or 0) >= 12:
        drivers.append("高い利益率による収益性")
    if (m.get("per") or 99) <= 15:
        drivers.append("相対的に割安なバリュエーションの是正余地")
    if (m.get("roe") or 0) >= 12:
        drivers.append("高ROEに表れる資本効率")
    if (m.get("dividend_yield") or 0) >= 3:
        drivers.append("配当によるインカム妙味")

    if drivers:
        findings.append("強気シナリオのドライバー: " + " / ".join(drivers) + "。")
        findings.append("前提: 上記の傾向が今後も維持されること。"
                        "検証条件: 次回決算での増収増益の継続と計画進捗。")
    else:
        findings.append("明確な強気ドライバーは現時点のデータからは弱い。"
                        "触媒（新製品・構造改革・株主還元強化など）の確認が必要。")
    # 仮説モジュールはスコアを持たない（材料提供）
    return AnalysisResult("hypothesis", "投資仮説", None,
                          {"ドライバー数": len(drivers)}, findings, [])


# ---------------------------------------------------------------------------
# 9. 反証分析
# ---------------------------------------------------------------------------
def counter_analysis(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    counters = []
    if (m.get("per") or 0) >= 30:
        counters.append("高PERで、期待未達時の下落余地が大きい")
    if (m.get("revenue_growth_yoy") or 1) < 0:
        counters.append("減収基調で、成長ストーリーが崩れている")
    if (m.get("equity_ratio") or 100) < 30:
        counters.append("自己資本比率が低く、景気後退時に脆弱")
    if (m.get("free_cf") or 1) < 0:
        counters.append("フリーCFがマイナスで、資金繰りに注意")
    if m.get("pct_from_high") is not None and m["pct_from_high"] < -25:
        counters.append("高値から大きく下落しており、下降トレンドの可能性")
    if (m.get("net_income_growth_yoy") or 1) < 0:
        counters.append("減益で、利益モメンタムが悪化")

    # 反証の強さをスコア化（強いほど低スコア）。総合のペナルティに使う。
    strength = min(len(counters), 4)
    score = 100.0 - strength * 20.0
    if counters:
        findings.append("弱気シナリオ（反証）: " + " / ".join(counters) + "。")
        flags.extend(counters[:2])
    else:
        findings.append("データ上、明確な反証材料は限定的。"
                        "ただし定性リスク（競争環境・規制・経営）は別途確認が必要。")
    return AnalysisResult("counter_analysis", "反証分析", score,
                          {"反証件数": len(counters)}, findings, flags)


# ---------------------------------------------------------------------------
# 10. リスク分析
# ---------------------------------------------------------------------------
def risk(data: StockData, m: dict) -> AnalysisResult:
    findings, flags = [], []
    risk_points = []
    # 各リスク要因を減点方式で評価（高スコア=低リスク）
    score = 100.0
    if (m.get("equity_ratio") or 100) < 30:
        score -= 20; risk_points.append("財務レバレッジ（自己資本比率<30%）")
    if (m.get("volatility_annual") or 0) > 40:
        score -= 15; risk_points.append("株価の高ボラティリティ")
    if (m.get("free_cf") or 1) < 0:
        score -= 15; risk_points.append("フリーCFマイナス")
    if (m.get("net_margin") or 10) < 3:
        score -= 10; risk_points.append("薄い利益率")
    if (m.get("debt_to_equity") or 0) > 2:
        score -= 15; risk_points.append("高い有利子負債比率")
    if (m.get("per") or 0) > 35:
        score -= 10; risk_points.append("高バリュエーションによる調整リスク")
    score = max(0.0, score)

    if risk_points:
        findings.append("主なリスク: " + " / ".join(risk_points) + "。")
        flags.extend(risk_points[:3])
    else:
        findings.append("定量指標上の大きなリスクフラグは検出されず。"
                        "為替・規制・地政学など定性リスクは別途確認。")
    findings.append("※ 下方シナリオ: 上記リスクが顕在化した場合、"
                    "利益・株価の下振れを想定して余裕を持った判断を。")
    return AnalysisResult("risk", "リスク分析", score,
                          {"検出リスク数": len(risk_points)}, findings, flags)


# ---------------------------------------------------------------------------
# 11. 複数投資家視点
# ---------------------------------------------------------------------------
def investor_views(data: StockData, m: dict) -> AnalysisResult:
    findings = []

    def verdict(cond_good: bool, cond_ok: bool) -> str:
        return "魅力的" if cond_good else ("一部魅力" if cond_ok else "対象外")

    per = m.get("per") or 99
    pbr = m.get("pbr") or 99
    growth_v = (m.get("revenue_cagr_3y") or m.get("revenue_growth_yoy") or 0)
    dy = m.get("dividend_yield") or 0
    roe = m.get("roe") or 0

    value_v = verdict(per <= 13 or pbr < 1, per <= 20)
    growth_view = verdict(growth_v >= 12, growth_v >= 6)
    dividend_v = verdict(dy >= 3.5, dy >= 2.5)
    quality_v = verdict(roe >= 15, roe >= 10)

    findings.append(f"バリュー投資家: {value_v}（PER {_fmt(per,'倍')} / PBR {_fmt(pbr,'倍')}）")
    findings.append(f"グロース投資家: {growth_view}（成長率 {_fmt(growth_v,'%')}）")
    findings.append(f"配当投資家: {dividend_v}（利回り {_fmt(dy,'%')}）")
    findings.append(f"クオリティ投資家: {quality_v}（ROE {_fmt(roe,'%')}）")

    n_good = sum(v == "魅力的" for v in (value_v, growth_view, dividend_v, quality_v))
    score = 30.0 + n_good * 17.5  # 0視点=30, 4視点=100
    return AnalysisResult("investor_views", "複数投資家視点", score,
                          {"魅力的な視点数": n_good}, findings, [])


# 実行順に並べたモジュール一覧
MODULES: list[Callable[[StockData, dict], AnalysisResult]] = [
    performance, earnings, financials, valuation, growth, price_action,
    market_expectation, hypothesis, counter_analysis, risk, investor_views,
]


def run_all(data: StockData, indicators: dict) -> list[AnalysisResult]:
    return [mod(data, indicators) for mod in MODULES]
