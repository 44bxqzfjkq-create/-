"""プロバイダの登録と生成。"""

from __future__ import annotations

from pathlib import Path

from .base import Provider
from .sample import SampleProvider
from .yfinance_provider import YFinanceProvider

_REGISTRY: dict[str, type[Provider]] = {
    "sample": SampleProvider,
    "yfinance": YFinanceProvider,
}


def get_provider(name: str, data_dir: Path) -> Provider:
    if name not in _REGISTRY:
        raise ValueError(
            f"未知のプロバイダ '{name}'。利用可能: {', '.join(_REGISTRY)}"
        )
    return _REGISTRY[name](data_dir)


__all__ = ["Provider", "get_provider"]
