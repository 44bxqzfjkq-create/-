"""総合スコアリング。

各モジュールのサブスコアを重み付き平均し、リスク/反証はペナルティとして反映。
データ不足で判定保留(None)のモジュールは平均から除外し、
「何件が保留か」をレポートに明示する（0点扱いにしない）。
"""

from __future__ import annotations

from typing import Any

from ..models import AnalysisResult


# 総合平均に含める（＝プラス評価の）モジュール
_POSITIVE = {
    "performance", "earnings", "financials", "valuation",
    "growth", "price_action", "market_expectation", "investor_views",
}


def total_score(results: list[AnalysisResult], weights: dict[str, float]) -> dict[str, Any]:
    by_mod = {r.module: r for r in results}

    num = 0.0
    den = 0.0
    used, held = [], []
    for r in results:
        if r.module not in _POSITIVE:
            continue
        if r.score is None:
            held.append(r.module)
            continue
        w = float(weights.get(r.module, 1.0))
        num += r.score * w
        den += w
        used.append(r.module)

    base = (num / den) if den > 0 else None

    # ---- ペナルティ（リスク・反証）----
    penalties = []
    score = base
    if base is not None:
        risk_r = by_mod.get("risk")
        if risk_r and risk_r.score is not None:
            # リスクスコアが低い(危険)ほど減点。基準50。
            rw = float(weights.get("risk_penalty_weight", 1.0))
            pen = (50.0 - risk_r.score) / 100.0 * 15.0 * rw
            if pen > 0:
                score -= pen
                penalties.append(f"リスク減点 -{pen:.1f}")
        ca_r = by_mod.get("counter_analysis")
        if ca_r and ca_r.score is not None:
            cw = float(weights.get("counter_penalty_weight", 0.5))
            pen = (100.0 - ca_r.score) / 100.0 * 12.0 * cw
            if pen > 0:
                score -= pen
                penalties.append(f"反証減点 -{pen:.1f}")
        score = max(0.0, min(100.0, score))

    return {
        "score": score,
        "base": base,
        "modules_used": used,
        "modules_held": held,
        "penalties": penalties,
        "rating": _rating(score),
    }


def _rating(score) -> str:
    if score is None:
        return "判定保留"
    if score >= 70:
        return "注目度・高"
    if score >= 55:
        return "注目度・中"
    if score >= 40:
        return "中立"
    return "慎重"
