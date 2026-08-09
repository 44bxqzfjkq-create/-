"""出典記録 (Provenance) — すべての取得データに来歴メタデータを付与する。

設計原則3「出典を必ず記録」の実装。どのソースから・いつ・どの期間の
データを取得したかを残し、再現性とデータの信頼性判断を可能にする。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now_iso_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Provenance:
    """1回のデータ取得に対する来歴レコード。"""

    source: str                      # 例: "yfinance", "sample(synthetic)"
    source_type: str                 # official_api / unofficial / sample_synthetic
    target_entity: str               # 例: "7203 トヨタ自動車"
    data_kind: str                   # price / financials / master ...
    fetched_at_utc: str = field(default_factory=_now_iso_utc)
    api_version: str = ""
    accounting_period: str = ""      # 財務の会計期間
    disclosure_date: str = ""        # 入手可能になった日（Point-in-Time 用）
    period_start: str = ""           # 価格系列の開始日
    period_end: str = ""             # 価格系列の終了日
    params: dict[str, Any] = field(default_factory=dict)
    data_hash: str = ""
    notes: str = ""

    def with_hash(self, payload: Any) -> "Provenance":
        """データ本体のハッシュを計算して埋め込む（改変検知・再現性）。"""
        blob = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        self.data_hash = "sha256:" + hashlib.sha256(blob).hexdigest()[:32]
        return self

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_synthetic(self) -> bool:
        return self.source_type == "sample_synthetic"

    def one_line(self) -> str:
        base = f"{self.source} / {self.data_kind} / 取得 {self.fetched_at_utc}"
        if self.period_start and self.period_end:
            base += f" / 期間 {self.period_start}〜{self.period_end}"
        if self.accounting_period:
            base += f" / 会計期間 {self.accounting_period}"
        return base
