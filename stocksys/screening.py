"""スクリーニング (L4)。

設定ファイルの条件（"per <= 25" 等）で候補を絞る。条件はバックテストと
同じ指標定義を共有する（indicators.py が唯一の指標源）。
足切りであって推奨ではない — 通過/非通過の内訳を必ず残す。
"""

from __future__ import annotations

import operator
import re
from typing import Any, Optional

_OPS = {
    ">=": operator.ge, "<=": operator.le,
    ">": operator.gt, "<": operator.lt,
    "==": operator.eq,
}
_RULE_RE = re.compile(r"^\s*([a-zA-Z_][\w]*)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*$")


def parse_rule(rule: str) -> tuple[str, str, float]:
    m = _RULE_RE.match(rule)
    if not m:
        raise ValueError(f"スクリーニング条件を解釈できません: '{rule}'")
    field, op, value = m.group(1), m.group(2), float(m.group(3))
    return field, op, value


def eval_rule(metrics: dict[str, Any], rule: str) -> Optional[bool]:
    """条件を評価。指標が None（データ無し）なら None を返す（=判定不能）。"""
    field, op, value = parse_rule(rule)
    actual = metrics.get(field)
    if actual is None:
        return None
    return _OPS[op](actual, value)


def screen_one(metrics: dict[str, Any], rules: list[str],
               exclude: list[str] | None = None) -> dict[str, Any]:
    """1銘柄をルール群で評価し、通過可否と内訳を返す。"""
    exclude = exclude or []
    passed_rules, failed_rules, unknown_rules = [], [], []
    for rule in rules:
        res = eval_rule(metrics, rule)
        if res is None:
            unknown_rules.append(rule)
        elif res:
            passed_rules.append(rule)
        else:
            failed_rules.append(rule)

    excluded_by = [r for r in exclude if eval_rule(metrics, r) is True]

    # 全条件を満たし（判定不能は不合格扱いにしない＝保留として通過を妨げない設計も可能だが、
    # ここでは厳格に「明示的に満たした」ものだけ通過とする）、除外に該当しないこと
    passed = (len(failed_rules) == 0 and len(unknown_rules) == 0 and not excluded_by)
    return {
        "passed": passed,
        "passed_rules": passed_rules,
        "failed_rules": failed_rules,
        "unknown_rules": unknown_rules,
        "excluded_by": excluded_by,
    }
