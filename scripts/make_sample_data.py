"""同梱サンプル(デモ)データの生成スクリプト。

⚠ 生成される株価・財務は「合成データ」です。実際の市場データではありません。
   会社名・業種・市場区分・会計基準は公開情報に基づく実在の値ですが、
   数値（株価系列・売上・利益など）はパイプライン動作確認用の合成値です。

再実行しても同じ結果になるよう乱数シードを固定しています。
"""

from __future__ import annotations

import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "data" / "sample"
PRICES = SAMPLE / "prices"

# 会社の識別情報（実在の公開情報）＋ 合成の基準株価・財務パラメータ
COMPANIES = {
    "7203": dict(name="トヨタ自動車", sector="輸送用機器", market="プライム",
                 standard="IFRS", shares=13_000_000_000, price0=2800,
                 per=10.5, pbr=1.1, dy=2.6, roe_target=11,
                 rev=45_000_000, op=5_000_000, ni=4_800_000,
                 rev_prev=42_000_000, ni_prev=4_500_000, equity=32_000_000,
                 assets=90_000_000, debt=30_000_000, ocf=6_000_000, capex=-2_500_000,
                 rev_hist=[27_000_000, 30_000_000, 37_000_000, 42_000_000, 45_000_000],
                 ni_hist=[2_200_000, 2_800_000, 2_450_000, 4_500_000, 4_800_000]),
    "6758": dict(name="ソニーグループ", sector="電気機器", market="プライム",
                 standard="IFRS", shares=1_250_000_000, price0=13000,
                 per=18.0, pbr=2.2, dy=0.6, roe_target=13,
                 rev=13_000_000, op=1_200_000, ni=970_000,
                 rev_prev=11_500_000, ni_prev=880_000, equity=7_400_000,
                 assets=34_000_000, debt=2_000_000, ocf=1_500_000, capex=-800_000,
                 rev_hist=[8_600_000, 9_900_000, 10_800_000, 11_500_000, 13_000_000],
                 ni_hist=[580_000, 1_170_000, 880_000, 880_000, 970_000]),
    "6861": dict(name="キーエンス", sector="電気機器", market="プライム",
                 standard="日本基準", shares=243_000_000, price0=62000,
                 per=38.0, pbr=6.0, dy=0.5, roe_target=16,
                 rev=920_000, op=500_000, ni=360_000,
                 rev_prev=850_000, ni_prev=330_000, equity=2_300_000,
                 assets=2_600_000, debt=0, ocf=330_000, capex=-30_000,
                 rev_hist=[540_000, 580_000, 750_000, 850_000, 920_000],
                 ni_hist=[210_000, 230_000, 300_000, 330_000, 360_000]),
    "9984": dict(name="ソフトバンクグループ", sector="情報・通信業", market="プライム",
                 standard="IFRS", shares=1_450_000_000, price0=8500,
                 per=None, pbr=1.3, dy=0.5, roe_target=5,
                 rev=6_500_000, op=800_000, ni=-200_000,
                 rev_prev=6_200_000, ni_prev=-970_000, equity=13_000_000,
                 assets=46_000_000, debt=19_000_000, ocf=1_100_000, capex=-500_000,
                 rev_hist=[6_200_000, 5_600_000, 6_200_000, 6_200_000, 6_500_000],
                 ni_hist=[1_400_000, 4_990_000, -1_700_000, -970_000, -200_000]),
    "8306": dict(name="三菱UFJフィナンシャル・グループ", sector="銀行業", market="プライム",
                 standard="日本基準", shares=12_200_000_000, price0=1500,
                 per=11.0, pbr=0.85, dy=3.4, roe_target=8,
                 rev=9_000_000, op=1_800_000, ni=1_300_000,
                 rev_prev=8_200_000, ni_prev=1_100_000, equity=18_000_000,
                 assets=400_000_000, debt=None, ocf=None, capex=None,
                 rev_hist=[6_000_000, 6_100_000, 7_600_000, 8_200_000, 9_000_000],
                 ni_hist=[780_000, 1_040_000, 1_100_000, 1_100_000, 1_300_000]),
    "4568": dict(name="第一三共", sector="医薬品", market="プライム",
                 standard="IFRS", shares=1_940_000_000, price0=4800,
                 per=42.0, pbr=4.5, dy=1.0, roe_target=10,
                 rev=1_600_000, op=200_000, ni=150_000,
                 rev_prev=1_270_000, ni_prev=110_000, equity=1_600_000,
                 assets=2_800_000, debt=200_000, ocf=180_000, capex=-90_000,
                 rev_hist=[960_000, 1_040_000, 1_270_000, 1_270_000, 1_600_000],
                 ni_hist=[75_000, 70_000, 100_000, 110_000, 150_000]),
    "9433": dict(name="KDDI", sector="情報・通信業", market="プライム",
                 standard="IFRS", shares=2_200_000_000, price0=4300,
                 per=13.5, pbr=1.7, dy=3.2, roe_target=13,
                 rev=5_700_000, op=1_080_000, ni=680_000,
                 rev_prev=5_450_000, ni_prev=670_000, equity=5_200_000,
                 assets=11_000_000, debt=1_500_000, ocf=1_400_000, capex=-600_000,
                 rev_hist=[5_080_000, 5_310_000, 5_450_000, 5_450_000, 5_700_000],
                 ni_hist=[620_000, 651_000, 672_000, 670_000, 680_000]),
    "6098": dict(name="リクルートホールディングス", sector="サービス業", market="プライム",
                 standard="IFRS", shares=1_580_000_000, price0=6300,
                 per=30.0, pbr=4.0, dy=0.6, roe_target=15,
                 rev=3_400_000, op=380_000, ni=300_000,
                 rev_prev=3_000_000, ni_prev=270_000, equity=1_900_000,
                 assets=3_400_000, debt=100_000, ocf=350_000, capex=-80_000,
                 rev_hist=[2_270_000, 2_270_000, 2_870_000, 3_000_000, 3_400_000],
                 ni_hist=[130_000, 300_000, 300_000, 270_000, 300_000]),
}

# 会社計画・市場期待（一部銘柄のみ設定して該当モジュールを実演）
PLANS = {
    "7203": dict(progress_rate=32, vs_consensus=4.5, target_price=3300),
    "6758": dict(progress_rate=28, vs_consensus=-2.0, target_price=15500),
    "9433": dict(progress_rate=30, vs_consensus=1.0, target_price=5000),
    "8306": dict(progress_rate=35, vs_consensus=6.0, target_price=1750),
}


def make_prices(code: str, cfg: dict, ndays: int = 520) -> None:
    rng = random.Random(int(code))       # コード固定シード → 再現性
    drift = rng.uniform(-0.0003, 0.0007)
    vol = rng.uniform(0.012, 0.025)
    price = float(cfg["price0"])
    today = date(2026, 8, 7)
    start = today - timedelta(days=int(ndays * 1.5))

    rows = []
    d = start
    while len(rows) < ndays:
        if d.weekday() < 5:              # 平日のみ
            shock = rng.gauss(drift, vol)
            price = max(1.0, price * (1 + shock))
            o = price * (1 + rng.uniform(-0.01, 0.01))
            h = max(o, price) * (1 + rng.uniform(0, 0.012))
            lo = min(o, price) * (1 - rng.uniform(0, 0.012))
            volume = int(cfg["shares"] * rng.uniform(0.0003, 0.0015) / 100) * 100
            rows.append((d.isoformat(), round(o, 1), round(h, 1),
                         round(lo, 1), round(price, 1), volume))
        d += timedelta(days=1)

    PRICES.mkdir(parents=True, exist_ok=True)
    with (PRICES / f"{code}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "high", "low", "close", "volume"])
        w.writerows(rows)


def main() -> None:
    SAMPLE.mkdir(parents=True, exist_ok=True)

    companies_out = {}
    financials_out = {}
    for code, cfg in COMPANIES.items():
        companies_out[code] = dict(
            name=cfg["name"], sector=cfg["sector"], market=cfg["market"],
            accounting_standard=cfg["standard"], shares_outstanding=cfg["shares"],
        )
        fin = dict(
            accounting_period="FY2026 (synthetic)",
            disclosure_date="2026-05-10",
            revenue=cfg["rev"], revenue_prev=cfg["rev_prev"],
            operating_income=cfg["op"], net_income=cfg["ni"],
            net_income_prev=cfg["ni_prev"],
            total_assets=cfg["assets"], equity=cfg["equity"],
            interest_bearing_debt=cfg["debt"],
            operating_cf=cfg["ocf"], capex=cfg["capex"],
            free_cf=(cfg["ocf"] + cfg["capex"]) if (cfg["ocf"] is not None and cfg["capex"] is not None) else None,
            eps=(cfg["ni"] * 1_000_000 / cfg["shares"]) if cfg["ni"] else None,
            bps=(cfg["equity"] * 1_000_000 / cfg["shares"]) if cfg["equity"] else None,
            dividend_per_share=round(cfg["price0"] * cfg["dy"] / 100, 1),
            per=cfg["per"], pbr=cfg["pbr"], dividend_yield=cfg["dy"],
            revenue_history=cfg["rev_hist"], net_income_history=cfg["ni_hist"],
            company_plan={}, market_expectation={},
        )
        if code in PLANS:
            plan = PLANS[code]
            fin["company_plan"] = {"progress_rate": plan["progress_rate"],
                                   "vs_consensus": plan["vs_consensus"]}
            fin["market_expectation"] = {"target_price": plan["target_price"]}
        financials_out[code] = fin
        make_prices(code, cfg)

    with (SAMPLE / "companies.json").open("w", encoding="utf-8") as f:
        json.dump(companies_out, f, ensure_ascii=False, indent=2)
    with (SAMPLE / "financials.json").open("w", encoding="utf-8") as f:
        json.dump(financials_out, f, ensure_ascii=False, indent=2)

    print(f"生成完了: {len(COMPANIES)} 銘柄")
    print(f"  {SAMPLE/'companies.json'}")
    print(f"  {SAMPLE/'financials.json'}")
    print(f"  {PRICES}/*.csv")


if __name__ == "__main__":
    main()
