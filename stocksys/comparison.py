"""企業比較 (L4)。複数銘柄を同一基準で横並びにする。

業種・会計基準の違いは比較を歪めるため、比較表には必ず併記して注意喚起する。
"""

from __future__ import annotations

from typing import Any

# 比較に用いる指標（表示名, キー, 単位, 高いほど良いか）
COMPARE_FIELDS = [
    ("PER", "per", "倍", False),
    ("PBR", "pbr", "倍", False),
    ("配当利回り", "dividend_yield", "%", True),
    ("ROE", "roe", "%", True),
    ("営業利益率", "operating_margin", "%", True),
    ("自己資本比率", "equity_ratio", "%", True),
    ("売上成長(YoY)", "revenue_growth_yoy", "%", True),
    ("6か月リターン", "return_6m", "%", True),
]


def build_comparison(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """rows: [{code, name, sector, standard, metrics, total}] のリスト。

    各指標について銘柄間の相対順位（ベスト印）を付与して返す。
    """
    # 各フィールドのベスト値を特定
    best: dict[str, Any] = {}
    for label, key, unit, higher in COMPARE_FIELDS:
        vals = [(r["code"], r["metrics"].get(key)) for r in rows if r["metrics"].get(key) is not None]
        if not vals:
            continue
        best_code = (max if higher else min)(vals, key=lambda x: x[1])[0]
        best[key] = best_code

    sectors = {r["sector"] for r in rows if r.get("sector")}
    standards = {r.get("standard") for r in rows if r.get("standard")}
    warnings = []
    if len(sectors) > 1:
        warnings.append("業種が異なる銘柄が含まれます。PER/PBR等の水準は業種で大きく異なるため、"
                        "単純比較は避け、同業内での相対で解釈してください。")
    if len(standards) > 1:
        warnings.append("会計基準（IFRS/日本基準）が混在しています。利益・資産項目の比較に注意。")

    return {"fields": COMPARE_FIELDS, "best": best, "warnings": warnings, "rows": rows}
