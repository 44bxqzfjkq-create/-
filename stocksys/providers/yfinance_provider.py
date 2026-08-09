"""yfinance プロバイダ — Yahoo Finance から実データを取得する。

ネットワークの通る環境（例: 手元のPC）で `provider: yfinance` を指定すると、
このプロバイダが使われます。銘柄コードは内部で "7203" -> "7203.T" に変換します。

注意:
  - yfinance は非公式ライブラリのため、可用性・項目はYahoo側の仕様に依存します。
  - 財務は年次の主要項目のみを取得します（四半期・会社計画・コンセンサスは
    J-Quants/EDINET/有料コンセンサス導入時に拡張予定）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import pandas as pd

from ..models import Company, StockData
from ..provenance import Provenance
from .base import Provider


def _safe(df, row: str, col_idx: int = 0) -> Optional[float]:
    try:
        if df is None or df.empty or row not in df.index:
            return None
        val = df.loc[row].iloc[col_idx]
        return None if pd.isna(val) else float(val)
    except Exception:
        return None


class YFinanceProvider(Provider):
    name = "yfinance"

    def fetch(self, code: str) -> StockData:
        try:
            import yfinance as yf
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "yfinance がインストールされていません。`pip install yfinance` を実行してください。"
            ) from e

        symbol = code if "." in code else f"{code}.T"
        ticker = yf.Ticker(symbol)

        hist = ticker.history(period="max", auto_adjust=True)
        if hist.empty:
            raise RuntimeError(f"{symbol} の株価を取得できませんでした（コード確認 or ネットワーク）。")
        prices = hist.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]]
        prices.index = prices.index.tz_localize(None)
        prices.index.name = "date"

        info: dict[str, Any] = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}

        fin = self._extract_financials(ticker, info)

        company = Company(
            code=code,
            name=info.get("longName") or info.get("shortName") or symbol,
            sector=info.get("sector", ""),
            market=info.get("exchange", ""),
            shares_outstanding=info.get("sharesOutstanding"),
            accounting_standard="",
        )

        prov = [
            Provenance(
                source=f"yfinance ({symbol}) history",
                source_type="unofficial",
                target_entity=f"{code} {company.name}",
                data_kind="price",
                period_start=str(prices.index.min().date()),
                period_end=str(prices.index.max().date()),
                params={"symbol": symbol, "auto_adjust": True},
            ).with_hash({"rows": len(prices)}),
            Provenance(
                source=f"yfinance ({symbol}) financials/info",
                source_type="unofficial",
                target_entity=f"{code} {company.name}",
                data_kind="financials",
                notes="年次主要項目のみ。四半期・会社計画は未対応。",
            ).with_hash(fin),
        ]

        market = {
            "target_price": info.get("targetMeanPrice"),
            "recommendation": info.get("recommendationKey"),
            "num_analysts": info.get("numberOfAnalystOpinions"),
        }
        return StockData(company=company, prices=prices, financials=fin,
                         market=market, provenance=prov)

    def _extract_financials(self, ticker, info: dict) -> dict[str, Any]:
        """年次財務諸表から主要項目を抽出。"""
        fin_stmt = getattr(ticker, "financials", None)
        bs = getattr(ticker, "balance_sheet", None)
        cf = getattr(ticker, "cashflow", None)

        revenue = _safe(fin_stmt, "Total Revenue")
        op_income = _safe(fin_stmt, "Operating Income")
        net_income = _safe(fin_stmt, "Net Income")
        revenue_prev = _safe(fin_stmt, "Total Revenue", 1)
        net_income_prev = _safe(fin_stmt, "Net Income", 1)

        total_assets = _safe(bs, "Total Assets")
        equity = _safe(bs, "Stockholders Equity") or _safe(bs, "Total Stockholder Equity")
        debt = _safe(bs, "Total Debt")
        op_cf = _safe(cf, "Operating Cash Flow")
        capex = _safe(cf, "Capital Expenditure")

        return {
            "accounting_period": "yfinance annual (latest)",
            "disclosure_date": "",
            "revenue": revenue,
            "revenue_prev": revenue_prev,
            "operating_income": op_income,
            "net_income": net_income,
            "net_income_prev": net_income_prev,
            "total_assets": total_assets,
            "equity": equity,
            "interest_bearing_debt": debt,
            "operating_cf": op_cf,
            "capex": capex,
            "free_cf": (op_cf + capex) if (op_cf is not None and capex is not None) else None,
            "eps": info.get("trailingEps"),
            "bps": info.get("bookValue"),
            "dividend_per_share": info.get("dividendRate"),
            "per": info.get("trailingPE"),
            "pbr": info.get("priceToBook"),
            "dividend_yield": (info.get("dividendYield") or 0) * 100 if info.get("dividendYield") else None,
            "revenue_history": [],       # CAGR計算用（yfinanceでは簡易版のため空）
            "net_income_history": [],
            "company_plan": {},          # 会社計画は未対応
        }
