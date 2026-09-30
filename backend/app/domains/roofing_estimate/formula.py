"""A small spreadsheet-style formula language for material quantities.

Estimators already think in Excel: `ROUNDUP(roof_area_waste * 3)`, or
`IF(valley_lf > 15, ..., ...)`. A "measurement / coverage" pair cannot
express a conditional, so formulas are written out instead.

Evaluation is a real parse, not `eval`. The grammar below is the whole
language — there is no attribute access, no indexing, no calls to
anything but the whitelisted functions — so a formula typed into the
price-book screen cannot reach the interpreter.

    expr    := compare
    compare := sum (("=" | "<>" | "<" | "<=" | ">" | ">=") sum)?
    sum     := product (("+" | "-") product)*
    product := unary (("*" | "/") unary)*
    unary   := ("-" | "+")? power
    power   := atom ("^" unary)?
    atom    := NUMBER | NAME | NAME "(" args ")" | "(" expr ")"
"""

import math
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

MAX_LENGTH = 500


class FormulaError(ValueError):
    """A formula that cannot be parsed or evaluated."""


# ── Functions ──
#
# Excel semantics where they differ from Python: ROUNDUP always rounds
# away from zero, and IF short-circuits neither branch (both are already
# evaluated as plain numbers).

def _roundup(value: float, digits: float = 0) -> float:
    factor = 10 ** int(digits)
    return math.ceil(round(value * factor, 9)) / factor


def _rounddown(value: float, digits: float = 0) -> float:
    factor = 10 ** int(digits)
    return math.floor(round(value * factor, 9)) / factor


def _ceiling(value: float, significance: float = 1) -> float:
    if not significance:
        return 0.0
    return math.ceil(round(value / significance, 9)) * significance


def _floor(value: float, significance: float = 1) -> float:
    if not significance:
        return 0.0
    return math.floor(round(value / significance, 9)) * significance


FUNCTIONS: Dict[str, Tuple[Callable[..., float], int, Optional[int]]] = {
    # name: (impl, min args, max args or None for unlimited)
    "ROUNDUP": (_roundup, 1, 2),
    "ROUNDDOWN": (_rounddown, 1, 2),
    "ROUND": (lambda v, d=0: round(v, int(d)), 1, 2),
    "CEILING": (_ceiling, 1, 2),
    "FLOOR": (_floor, 1, 2),
    "INT": (lambda v: float(math.floor(v)), 1, 1),
    "ABS": (lambda v: abs(v), 1, 1),
    "MAX": (lambda *a: max(a), 1, None),
    "MIN": (lambda *a: min(a), 1, None),
    "SUM": (lambda *a: sum(a), 1, None),
    "IF": (lambda c, t, f=0.0: t if c else f, 2, 3),
    "AND": (lambda *a: 1.0 if all(bool(x) for x in a) else 0.0, 1, None),
    "OR": (lambda *a: 1.0 if any(bool(x) for x in a) else 0.0, 1, None),
    "NOT": (lambda v: 0.0 if v else 1.0, 1, 1),
    "SQRT": (lambda v: math.sqrt(v) if v >= 0 else 0.0, 1, 1),
}

FUNCTION_NAMES = sorted(FUNCTIONS)

_TOKEN_RE = re.compile(r"""
    (?P<space>\s+)
  | (?P<number>\d+(?:\.\d*)?|\.\d+)
  | (?P<name>[A-Za-z_][A-Za-z_0-9]*)
  | (?P<op><>|<=|>=|[-+*/^()<>=,])
""", re.VERBOSE)


def tokenize(text: str) -> List[Tuple[str, str]]:
    tokens: List[Tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        match = _TOKEN_RE.match(text, pos)
        if not match:
            raise FormulaError(f"Unexpected character: {text[pos]!r}")
        pos = match.end()
        kind = match.lastgroup
        if kind == "space":
            continue
        tokens.append((kind, match.group()))
    return tokens


class _Parser:
    """Recursive descent over the grammar in the module docstring."""

    def __init__(self, tokens: List[Tuple[str, str]],
                 variables: Dict[str, float]):
        self.tokens = tokens
        self.pos = 0
        self.variables = variables
        self.used: set = set()

    # -- token helpers --

    def peek(self) -> Optional[Tuple[str, str]]:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self, value: str) -> bool:
        tok = self.peek()
        if tok and tok[1].upper() == value:
            self.pos += 1
            return True
        return False

    def expect(self, value: str) -> None:
        if not self.take(value):
            tok = self.peek()
            found = tok[1] if tok else "end of formula"
            raise FormulaError(f"Expected {value!r} but found {found!r}")

    # -- grammar --

    def parse(self) -> float:
        value = self.expr()
        if self.peek():
            raise FormulaError(f"Unexpected token: {self.peek()[1]!r}")
        return value

    def expr(self) -> float:
        return self.compare()

    def compare(self) -> float:
        left = self.sum_()
        tok = self.peek()
        if tok and tok[0] == "op" and tok[1] in ("=", "<>", "<", "<=",
                                                 ">", ">="):
            self.pos += 1
            right = self.sum_()
            op = tok[1]
            result = {
                "=": left == right, "<>": left != right,
                "<": left < right, "<=": left <= right,
                ">": left > right, ">=": left >= right,
            }[op]
            return 1.0 if result else 0.0
        return left

    def sum_(self) -> float:
        value = self.product()
        while True:
            tok = self.peek()
            if tok and tok[1] == "+":
                self.pos += 1
                value += self.product()
            elif tok and tok[1] == "-":
                self.pos += 1
                value -= self.product()
            else:
                return value

    def product(self) -> float:
        value = self.unary()
        while True:
            tok = self.peek()
            if tok and tok[1] == "*":
                self.pos += 1
                value *= self.unary()
            elif tok and tok[1] == "/":
                self.pos += 1
                divisor = self.unary()
                # A blank measurement should read as "no material", not
                # blow up the whole cost breakdown.
                value = value / divisor if divisor else 0.0
            else:
                return value

    def unary(self) -> float:
        if self.take("-"):
            return -self.unary()
        if self.take("+"):
            return self.unary()
        return self.power()

    def power(self) -> float:
        base = self.atom()
        if self.take("^"):
            exponent = self.unary()
            try:
                return float(base ** exponent)
            except (OverflowError, ValueError):
                raise FormulaError("Exponent could not be evaluated")
        return base

    def atom(self) -> float:
        tok = self.peek()
        if not tok:
            raise FormulaError("Formula is incomplete")

        kind, text = tok
        if kind == "number":
            self.pos += 1
            return float(text)

        if kind == "name":
            self.pos += 1
            upper = text.upper()
            nxt = self.peek()
            if nxt and nxt[1] == "(":
                return self.call(upper)
            # A bare name is a measurement.
            key = text.lower()
            if key not in self.variables:
                raise FormulaError(f"Unknown variable: {text}")
            self.used.add(key)
            return float(self.variables[key])

        if text == "(":
            self.pos += 1
            value = self.expr()
            self.expect(")")
            return value

        raise FormulaError(f"Unexpected token: {text!r}")

    def call(self, name: str) -> float:
        if name not in FUNCTIONS:
            raise FormulaError(f"Unknown function: {name}")
        self.expect("(")
        args: List[float] = []
        if not self.take(")"):
            args.append(self.expr())
            while self.take(","):
                args.append(self.expr())
            self.expect(")")

        impl, lo, hi = FUNCTIONS[name]
        if len(args) < lo or (hi is not None and len(args) > hi):
            expected = f"{lo}" if hi == lo else f"{lo}-{hi or 'unlimited'}"
            raise FormulaError(
                f"{name} takes {expected} argument(s), "
                f"got {len(args)}")
        try:
            return float(impl(*args))
        except FormulaError:
            raise
        except Exception as exc:
            raise FormulaError(f"{name} failed: {exc}")


def evaluate(formula: str, variables: Dict[str, float]) -> float:
    """Run `formula` against named measurements. Raises FormulaError."""
    if formula is None or not str(formula).strip():
        raise FormulaError("Formula is empty")
    text = str(formula).strip()
    if len(text) > MAX_LENGTH:
        raise FormulaError(f"Formula is too long (max {MAX_LENGTH} characters)")
    # Excel users start with "="; accept it and ignore.
    if text.startswith("="):
        text = text[1:]

    parser = _Parser(tokenize(text), variables)
    value = parser.parse()
    if isinstance(value, bool):
        value = 1.0 if value else 0.0
    if value != value or value in (float("inf"), float("-inf")):
        raise FormulaError("Formula did not produce a usable number")
    return float(value)


def validate(formula: str, variables: Dict[str, float]) -> Dict[str, Any]:
    """Check a formula without trusting the result.

    Returns {ok, value, error, used}. `variables` should be a sample roof
    so the screen can show what the formula produces as it is typed.
    """
    try:
        parser = _Parser(tokenize(
            str(formula).strip().lstrip("=")), variables)
        value = parser.parse()
        return {
            "ok": True,
            "value": round(float(value), 4),
            "error": None,
            "used": sorted(parser.used),
        }
    except FormulaError as exc:
        return {"ok": False, "value": None, "error": str(exc), "used": []}
    except Exception as exc:  # pragma: no cover - defensive
        return {"ok": False, "value": None,
                "error": f"Formula error: {exc}", "used": []}
