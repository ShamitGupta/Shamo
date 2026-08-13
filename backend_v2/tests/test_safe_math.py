"""safe_math is the only thing standing between a model-supplied expression
string and Python's eval. Every case here is either "this is ordinary
x-arithmetic and must work" or "this is a known code-execution shape and must
be rejected", because the whole point of the module is that the second
category is unreachable, not merely discouraged.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.safe_math import UnsafeExpressionError, make_evaluator, validate_expression  # noqa: E402


@pytest.mark.parametrize(
    ("expr", "x", "expected"),
    [
        ("x", 3, 3),
        ("2*x + 1", 5, 11),
        ("x**2 - 4", 3, 5),
        ("x^2 - 4", 3, 5),  # "^" is normalized to "**", not treated as XOR
        ("1/2*x + 4/x", 2, 3),
        ("sqrt(x)", 9, 3),
        ("sin(0)", 1, 0),
        ("-x", 4, -4),
        ("pi", 0, math.pi),
        ("e", 0, math.e),
    ],
)
def test_ordinary_arithmetic_evaluates_correctly(expr, x, expected):
    evaluator = make_evaluator(expr)
    assert evaluator(x) == pytest.approx(expected)


@pytest.mark.parametrize(
    "expr",
    [
        "__import__('os').system('echo pwned')",
        "().__class__.__bases__[0]",
        "open('/etc/passwd').read()",
        "[y for y in range(10)]",
        "lambda x: x",
        "x.__class__",
        "eval('1')",
        "exec('1')",
        "os.system('echo hi')",
        "1; 2",
        "x if x else 1",
        "globals()",
        "not_a_real_function(x)",
        "x = 5",
    ],
)
def test_code_execution_shapes_are_rejected(expr):
    with pytest.raises(UnsafeExpressionError):
        validate_expression(expr)


def test_keyword_arguments_are_rejected():
    with pytest.raises(UnsafeExpressionError):
        validate_expression("log(x, base=2)")


def test_boolean_literal_is_rejected():
    # bool is a subclass of int, so this needs its own guard.
    with pytest.raises(UnsafeExpressionError):
        validate_expression("True")


def test_empty_expression_is_rejected():
    with pytest.raises(UnsafeExpressionError):
        validate_expression("")


def test_overlong_expression_is_rejected():
    with pytest.raises(UnsafeExpressionError):
        validate_expression("x+" * 100 + "1")


def test_division_by_zero_raises_at_call_time_not_validation_time():
    evaluator = make_evaluator("1/x")
    validate_expression("1/x")  # does not raise: the expression shape is safe
    with pytest.raises(ZeroDivisionError):
        evaluator(0)
