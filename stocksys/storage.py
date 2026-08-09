"""ストレージ層。パスの解決と、出典レコード・レポートの保存を担う。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml


class Config:
    """settings.yaml を読み込んだ設定オブジェクト。"""

    def __init__(self, data: dict[str, Any], root: Path):
        self._d = data
        self.root = root

    @classmethod
    def load(cls, path: str | Path = "config/settings.yaml") -> "Config":
        p = Path(path)
        with p.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
        # 設定ファイルの位置から見たプロジェクトルート
        root = p.resolve().parent.parent
        return cls(data, root)

    def get(self, key: str, default: Any = None) -> Any:
        return self._d.get(key, default)

    @property
    def provider(self) -> str:
        return self._d.get("provider", "sample")

    @property
    def universe(self) -> list[str]:
        return [str(c) for c in self._d.get("universe", [])]

    @property
    def weights(self) -> dict[str, float]:
        return self._d.get("weights", {})

    @property
    def screening(self) -> dict[str, Any]:
        return self._d.get("screening", {})

    @property
    def data_dir(self) -> Path:
        return self.root / self._d.get("paths", {}).get("data_dir", "data")

    @property
    def reports_dir(self) -> Path:
        return self.root / self._d.get("paths", {}).get("reports_dir", "reports")


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_metadata(data_dir: Path, code: str, records: list[dict[str, Any]]) -> Path:
    """出典レコードを data/metadata/<code>.json に保存。"""
    meta_dir = ensure_dir(data_dir / "metadata")
    out = meta_dir / f"{code}.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    return out


def save_report(reports_dir: Path, name: str, content: str) -> Path:
    ensure_dir(reports_dir)
    out = reports_dir / name
    with out.open("w", encoding="utf-8") as f:
        f.write(content)
    return out
