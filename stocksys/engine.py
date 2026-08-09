"""オーケストレーション: 取得 → 指標計算 → 11分析 → 総合スコア。

各アプリ機能（analyze / screen / compare）が共通で使う分析パイプライン。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .analysis import run_all, total_score
from .indicators import compute_indicators
from .models import AnalysisResult, StockData
from .providers import get_provider
from .storage import Config, save_metadata


@dataclass
class AnalysisBundle:
    data: StockData
    indicators: dict[str, Any]
    results: list[AnalysisResult]
    scoring: dict[str, Any]

    @property
    def flat_metrics(self) -> dict[str, Any]:
        """スクリーニング用のフラットな指標辞書（指標＋総合スコア）。"""
        m = dict(self.indicators)
        m["total_score"] = self.scoring.get("score")
        return m


def analyze_code(cfg: Config, code: str, save_meta: bool = True) -> AnalysisBundle:
    provider = get_provider(cfg.provider, cfg.data_dir)
    data = provider.fetch(code)

    if save_meta:
        save_metadata(cfg.data_dir, code, [p.to_dict() for p in data.provenance])

    indicators = compute_indicators(data)
    results = run_all(data, indicators)
    scoring = total_score(results, cfg.weights)
    return AnalysisBundle(data=data, indicators=indicators,
                          results=results, scoring=scoring)
