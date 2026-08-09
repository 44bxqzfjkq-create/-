"""サンプル(デモ)プロバイダ — オフラインで動く合成データ源。

⚠ 重要: ここが返す株価・財務は「合成されたデモ用データ」であり、
実際の市場データではありません。パイプラインが動くことを確認したり、
レポートの見た目を確認するための土台です。出典(provenance)には
source_type="sample_synthetic" が刻まれ、レポートにも明示されます。

実データを使うには config の provider を yfinance に切り替え、
ネットワークの通る環境で実行してください。
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from ..models import Company, StockData
from ..provenance import Provenance
from .base import Provider


class SampleProvider(Provider):
    name = "sample"

    def __init__(self, data_dir: Path):
        super().__init__(data_dir)
        self.sample_dir = data_dir / "sample"

    def _load_json(self, name: str) -> dict:
        path = self.sample_dir / name
        with path.open(encoding="utf-8") as f:
            return json.load(f)

    def fetch(self, code: str) -> StockData:
        companies = self._load_json("companies.json")
        financials_all = self._load_json("financials.json")

        if code not in companies:
            raise KeyError(
                f"銘柄コード {code} はサンプルデータに含まれていません。"
                f" 利用可能: {', '.join(companies.keys())}"
            )

        c = companies[code]
        company = Company(
            code=code,
            name=c["name"],
            sector=c.get("sector", ""),
            market=c.get("market", ""),
            shares_outstanding=c.get("shares_outstanding"),
            accounting_standard=c.get("accounting_standard", ""),
        )

        price_path = self.sample_dir / "prices" / f"{code}.csv"
        prices = pd.read_csv(price_path, parse_dates=["date"]).set_index("date")
        prices = prices.rename(columns=str.lower)

        fin = financials_all.get(code, {})

        prov = [
            Provenance(
                source="sample(synthetic)",
                source_type="sample_synthetic",
                target_entity=f"{code} {company.name}",
                data_kind="price",
                period_start=str(prices.index.min().date()),
                period_end=str(prices.index.max().date()),
                notes="合成デモデータ。実市場データではありません。",
            ).with_hash({"rows": len(prices)}),
            Provenance(
                source="sample(synthetic)",
                source_type="sample_synthetic",
                target_entity=f"{code} {company.name}",
                data_kind="financials",
                accounting_period=fin.get("accounting_period", ""),
                disclosure_date=fin.get("disclosure_date", ""),
                notes="合成デモデータ。実市場データではありません。",
            ).with_hash(fin),
        ]

        market = fin.get("market_expectation", {})
        return StockData(
            company=company,
            prices=prices,
            financials=fin,
            market=market,
            provenance=prov,
        )
