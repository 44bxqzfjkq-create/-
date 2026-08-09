"""共通データモデル。

プロバイダ層が返す `StockData` と、分析層が返す `AnalysisResult` を定義する。
分析モジュールはこの共通形だけに依存するので、データ源(sample/yfinance/J-Quants)
が変わっても分析コードは影響を受けない。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import pandas as pd

from .provenance import Provenance


@dataclass
class Company:
    code: str                    # "7203"
    name: str                    # "トヨタ自動車"
    sector: str = ""             # 業種
    market: str = ""             # 市場区分
    shares_outstanding: Optional[float] = None
    accounting_standard: str = ""  # IFRS / JGAAP など（比較の注意喚起用）


@dataclass
class StockData:
    """1銘柄分の生データ束。"""

    company: Company
    prices: pd.DataFrame                 # index=日付, columns: open/high/low/close/volume
    financials: dict[str, Any] = field(default_factory=dict)
    market: dict[str, Any] = field(default_factory=dict)   # 市場期待・コンセンサス等
    provenance: list[Provenance] = field(default_factory=list)

    @property
    def is_synthetic(self) -> bool:
        return any(p.is_synthetic for p in self.provenance)

    @property
    def latest_close(self) -> Optional[float]:
        if self.prices is None or self.prices.empty:
            return None
        return float(self.prices["close"].iloc[-1])


@dataclass
class AnalysisResult:
    """1分析モジュールの出力。"""

    module: str                      # "valuation" など
    title: str                       # 日本語見出し
    score: Optional[float]           # 0〜100。データ不足時は None（=判定保留）
    metrics: dict[str, Any] = field(default_factory=dict)   # 計算した指標
    findings: list[str] = field(default_factory=list)       # 根拠つき所見（文章）
    flags: list[str] = field(default_factory=list)          # 注意点・リスク

    @property
    def held(self) -> bool:
        """判定保留か。"""
        return self.score is None
