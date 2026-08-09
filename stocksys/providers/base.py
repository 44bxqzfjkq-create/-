"""データ取得プロバイダの基底クラス。

新しいデータ源（例: J-Quants）を足すときは、このクラスを継承して
`fetch()` を実装し、providers/__init__.py の get_provider に登録するだけでよい。
分析層はこのインターフェースにしか依存しない。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..models import StockData


class Provider(ABC):
    name: str = "base"

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir

    @abstractmethod
    def fetch(self, code: str) -> StockData:
        """銘柄コードから StockData を取得する（出典レコードつき）。"""
        raise NotImplementedError
