"""コマンドライン入口。

使用例:
  python -m stocksys analyze 7203
  python -m stocksys analyze 7203 --html
  python -m stocksys screen --preset value_growth
  python -m stocksys compare 7203 6758 6861
  python -m stocksys list
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from .comparison import build_comparison
from .engine import analyze_code
from .reporting import html_report, md_report
from .screening import screen_one
from .storage import Config, save_report


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _load_cfg(args) -> Config:
    cfg = Config.load(args.config)
    if args.provider:
        cfg._d["provider"] = args.provider
    return cfg


def cmd_list(args) -> int:
    cfg = _load_cfg(args)
    print(f"provider = {cfg.provider}")
    print("ユニバース:")
    for code in cfg.universe:
        print(f"  {code}")
    return 0


def cmd_analyze(args) -> int:
    cfg = _load_cfg(args)
    print(f"[{cfg.provider}] {args.code} を分析中 ...", file=sys.stderr)
    bundle = analyze_code(cfg, args.code)

    sc = bundle.scoring
    print(f"  総合スコア: {sc['score']:.1f} ({sc['rating']})" if sc["score"] is not None
          else "  総合スコア: 判定保留", file=sys.stderr)

    md = md_report.render_analysis(bundle)
    name = f"analyze_{args.code}_{_stamp()}.md"
    path = save_report(cfg.reports_dir, name, md)
    print(f"  Markdown: {path}")

    if args.html:
        html = html_report.render_analysis(bundle)
        hname = f"analyze_{args.code}_{_stamp()}.html"
        hpath = save_report(cfg.reports_dir, hname, html)
        print(f"  HTML: {hpath}")

    if args.stdout:
        print("\n" + md)
    return 0


def cmd_screen(args) -> int:
    cfg = _load_cfg(args)
    presets = cfg.screening.get("presets", {})
    if args.preset not in presets:
        print(f"プリセット '{args.preset}' が見つかりません。利用可能: {', '.join(presets)}",
              file=sys.stderr)
        return 2
    preset = presets[args.preset]
    rules = preset.get("rules", [])
    exclude = cfg.screening.get("exclude", [])

    ranked = []
    synthetic = False
    for code in cfg.universe:
        try:
            bundle = analyze_code(cfg, code, save_meta=False)
        except Exception as e:  # noqa: BLE001
            print(f"  {code}: 取得失敗 ({e})", file=sys.stderr)
            continue
        synthetic = synthetic or bundle.data.is_synthetic
        metrics = bundle.flat_metrics
        screen = screen_one(metrics, rules, exclude)
        ranked.append({
            "code": code, "name": bundle.data.company.name,
            "metrics": metrics, "total": bundle.scoring["score"],
            "screen": screen,
        })

    ranked.sort(key=lambda r: (r["total"] is not None, r["total"] or 0), reverse=True)
    md = md_report.render_screening(preset.get("label", args.preset), ranked,
                                    cfg.provider, synthetic)
    name = f"screen_{args.preset}_{_stamp()}.md"
    path = save_report(cfg.reports_dir, name, md)
    n_pass = sum(1 for r in ranked if r["screen"]["passed"])
    print(f"  条件通過 {n_pass}/{len(ranked)} 銘柄")
    print(f"  Markdown: {path}")
    if args.stdout:
        print("\n" + md)
    return 0


def cmd_compare(args) -> int:
    cfg = _load_cfg(args)
    rows = []
    synthetic = False
    for code in args.codes:
        bundle = analyze_code(cfg, code, save_meta=False)
        synthetic = synthetic or bundle.data.is_synthetic
        rows.append({
            "code": code, "name": bundle.data.company.name,
            "sector": bundle.data.company.sector,
            "standard": bundle.data.company.accounting_standard,
            "metrics": bundle.indicators, "total": bundle.scoring["score"],
        })
    comp = build_comparison(rows)
    md = md_report.render_comparison(comp, cfg.provider, synthetic)
    name = f"compare_{'-'.join(args.codes)}_{_stamp()}.md"
    path = save_report(cfg.reports_dir, name, md)
    print(f"  Markdown: {path}")
    if args.stdout:
        print("\n" + md)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="stocksys", description="株式分析システム (総合分析・材料整理)")
    p.add_argument("--config", default="config/settings.yaml", help="設定ファイル")
    p.add_argument("--provider", default=None, help="sample / yfinance（設定を上書き）")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("list", help="ユニバースとプロバイダを表示")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("analyze", help="1銘柄の総合分析レポートを生成")
    sp.add_argument("code", help="銘柄コード（例: 7203）")
    sp.add_argument("--html", action="store_true", help="HTMLレポートも出力")
    sp.add_argument("--stdout", action="store_true", help="Markdownを標準出力にも表示")
    sp.set_defaults(func=cmd_analyze)

    sp = sub.add_parser("screen", help="ユニバースをスクリーニング")
    sp.add_argument("--preset", default="default", help="プリセット名")
    sp.add_argument("--stdout", action="store_true")
    sp.set_defaults(func=cmd_screen)

    sp = sub.add_parser("compare", help="複数銘柄を比較")
    sp.add_argument("codes", nargs="+", help="銘柄コード（2つ以上）")
    sp.add_argument("--stdout", action="store_true")
    sp.set_defaults(func=cmd_compare)

    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
