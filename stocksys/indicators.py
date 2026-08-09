"""指標計算層 (L2)。

StockData（生データ）から、分析モジュールとスクリーニングが共通で使う
指標辞書を計算する。ここに計算を集約することで、分析とスクリーニングが
必ず同じ定義の指標を見るようにする（設計原則: 再現性・整合性）。
"""

from __future__ import annotations

import math
from typing import Any, Optional

import pandas as pd

from .models import StockData


def _pct_change(now: Optional[float], prev: Optional[float]) -> Optional[float]:
    if now is None or prev in (None, 0):
        return None
    return (now - prev) / abs(prev) * 100.0


def _cagr(series: list[float]) -> Optional[float]:
    """年次系列（古い→新しい）から CAGR(%) を計算。"""
    vals = [v for v in series if v is not None and v > 0]
    if len(vals) < 2:
        return None
    years = len(vals) - 1
    try:
        return ((vals[-1] / vals[0]) ** (1.0 / years) - 1.0) * 100.0
    except (ValueError, ZeroDivisionError):
        return None


def _sma(close: pd.Series, window: int) -> Optional[float]:
    if len(close) < window:
        return None
    return float(close.tail(window).mean())


def compute_indicators(data: StockData) -> dict[str, Any]:
    """総合指標辞書を返す。値が計算不能なら None（=判定保留の材料）。"""
    fin = data.financials or {}
    m: dict[str, Any] = {}

    close = data.prices["close"] if not data.prices.empty else pd.Series(dtype=float)
    price = float(close.iloc[-1]) if len(close) else None
    m["price"] = price

    # ---- 財務の基礎項目 ----
    revenue = fin.get("revenue")
    op_income = fin.get("operating_income")
    net_income = fin.get("net_income")
    equity = fin.get("equity")
    total_assets = fin.get("total_assets")
    debt = fin.get("interest_bearing_debt")
    eps = fin.get("eps")
    bps = fin.get("bps")
    dps = fin.get("dividend_per_share")
    shares = data.company.shares_outstanding

    # ---- 収益性 ----
    m["operating_margin"] = (op_income / revenue * 100.0) if (op_income and revenue) else None
    m["net_margin"] = (net_income / revenue * 100.0) if (net_income and revenue) else None
    m["roe"] = (net_income / equity * 100.0) if (net_income and equity) else None
    m["roa"] = (net_income / total_assets * 100.0) if (net_income and total_assets) else None

    # ---- 財務健全性 ----
    m["equity_ratio"] = (equity / total_assets * 100.0) if (equity and total_assets) else None
    m["debt_to_equity"] = (debt / equity) if (debt is not None and equity) else None
    op_cf = fin.get("operating_cf")
    m["free_cf"] = fin.get("free_cf")
    m["operating_cf"] = op_cf

    # ---- 成長性 ----
    m["revenue_growth_yoy"] = _pct_change(revenue, fin.get("revenue_prev"))
    m["net_income_growth_yoy"] = _pct_change(net_income, fin.get("net_income_prev"))
    m["revenue_cagr_3y"] = _cagr(fin.get("revenue_history", []))
    m["net_income_cagr_3y"] = _cagr(fin.get("net_income_history", []))

    # ---- バリュエーション ----
    per = fin.get("per")
    if per is None and eps not in (None, 0) and price:
        per = price / eps
    pbr = fin.get("pbr")
    if pbr is None and bps not in (None, 0) and price:
        pbr = price / bps
    m["per"] = per
    m["pbr"] = pbr
    dy = fin.get("dividend_yield")
    if dy is None and dps and price:
        dy = dps / price * 100.0
    m["dividend_yield"] = dy
    if per is not None and (m["roe"] is not None):
        # PEG風: PER / 利益成長。成長が取れなければ None
        g = m["net_income_growth_yoy"] or m["net_income_cagr_3y"]
        m["peg"] = (per / g) if (g and g > 0) else None
    else:
        m["peg"] = None

    # ---- 株価テクニカル ----
    if len(close):
        m["sma25"] = _sma(close, 25)
        m["sma75"] = _sma(close, 75)
        m["sma200"] = _sma(close, 200)
        m["high_52w"] = float(close.tail(250).max()) if len(close) >= 20 else None
        m["low_52w"] = float(close.tail(250).min()) if len(close) >= 20 else None
        ret = close.pct_change().dropna()
        m["volatility_annual"] = float(ret.tail(250).std() * math.sqrt(250) * 100.0) if len(ret) >= 20 else None
        if len(close) >= 130:
            past = float(close.iloc[-126])
            m["return_6m"] = (price / past - 1.0) * 100.0 if past else None
        else:
            m["return_6m"] = None
        # 52週高値からの位置(%)
        if m.get("high_52w"):
            m["pct_from_high"] = (price / m["high_52w"] - 1.0) * 100.0
    else:
        for k in ("sma25", "sma75", "sma200", "high_52w", "low_52w",
                  "volatility_annual", "return_6m", "pct_from_high"):
            m[k] = None

    # ---- 市場期待 ----
    tp = (data.market or {}).get("target_price")
    m["target_price"] = tp
    m["upside_to_target"] = ((tp / price - 1.0) * 100.0) if (tp and price) else None

    return m


def clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def score_linear(value: Optional[float], low: float, high: float,
                 reverse: bool = False) -> Optional[float]:
    """value を [low, high] に対して 0〜100 に線形マップ。

    reverse=True なら「小さいほど高得点」（PER等の割安指標向け）。
    value が None なら None（判定保留）。
    """
    if value is None:
        return None
    if high == low:
        return 50.0
    t = (value - low) / (high - low)
    t = max(0.0, min(1.0, t))
    return clamp((1.0 - t) * 100.0 if reverse else t * 100.0)
