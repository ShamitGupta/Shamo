"""A restricted arithmetic evaluator for model-supplied f(x) expressions.

Manim's region-sweep template needs to evaluate a student-facing expression
like ``0.5*x + 4/x`` many times while plotting a curve. The model proposes
that expression as a plain string, and a plain string handed to ``eval`` is
arbitrary code execution on a service holding Supabase and OpenAI
credentials -- exactly the risk this module exists to remove.

The approach: parse with ``ast.parse`` and walk the tree BEFORE compiling
anything, rejecting every node that is not one of a small whitelist (numeric
literals, +-*/**, unary +-, the name ``x``, and a fixed set of math
functions/constants). Only a tree that passes the walk is compiled and run,
and it runs against a namespace with ``__builtins__`` stripped, so there is
no reachable path to attribute access, subscripting, comprehensions, lambdas,
or imports even if the whitelist walk were somehow wrong about a node.
"""

from __future__ import annotations

import ast
import math
from typing import Callable

_ALLOWED_FUNCS: dict[str, Callable[..., float]] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "sqrt": math.sqrt,
    "exp": math.exp,
    "log": math.log,
    "abs": abs,
}
_ALLOWED_NAMES: dict[str, float] = {"pi": math.pi, "e": math.e}
_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)
_ALLOWED_UNARYOPS = (ast.UAdd, ast.USub)

MAX_EXPRESSION_LENGTH = 80


class UnsafeExpressionError(ValueError):
    """The expression contains something outside the allowed grammar."""


def _check_node(node: ast.AST) -> None:
    if isinstance(node, ast.Expression):
        _check_node(node.body)
        return
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
        _check_node(node.left)
        _check_node(node.right)
        return
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARYOPS):
        _check_node(node.operand)
        return
    if isinstance(node, ast.Call):
        if (
            not isinstance(node.func, ast.Name)
            or node.func.id not in _ALLOWED_FUNCS
            or node.keywords
        ):
            raise UnsafeExpressionError("only plain calls to a fixed set of math functions are allowed")
        for arg in node.args:
            _check_node(arg)
        return
    if isinstance(node, ast.Name):
        if node.id != "x" and node.id not in _ALLOWED_NAMES:
            raise UnsafeExpressionError(f"name is not allowed: {node.id}")
        return
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return
    raise UnsafeExpressionError(f"expression contains a disallowed construct: {type(node).__name__}")


def _normalize(expr: str) -> str:
    # "^" reads as exponentiation to a student (and to the prompt that asks
    # the model for it) but is Python's XOR operator, which _check_node would
    # then have to allow -- so it is rewritten to "**" before anything parses
    # it, rather than teaching the whitelist to accept a bitwise op.
    return expr.replace("^", "**")


def _parse(expr: str) -> ast.Expression:
    if not expr or len(expr) > MAX_EXPRESSION_LENGTH:
        raise UnsafeExpressionError("expression is empty or too long")
    try:
        tree = ast.parse(_normalize(expr), mode="eval")
    except SyntaxError as error:
        raise UnsafeExpressionError(f"could not parse expression: {error}") from error
    _check_node(tree)
    return tree


def validate_expression(expr: str) -> None:
    """Raise UnsafeExpressionError if expr is anything but bounded x-arithmetic."""

    _parse(expr)


def make_evaluator(expr: str) -> Callable[[float], float]:
    """Validate expr, then return a fast f(x) closure over it.

    Re-validates even if the caller already did, because a closure that
    outlives the validation call site is exactly the kind of thing that gets
    reused somewhere the check was skipped.
    """

    tree = _parse(expr)
    compiled = compile(tree, "<safe-expr>", "eval")
    namespace = {**_ALLOWED_FUNCS, **_ALLOWED_NAMES}

    def _evaluate(x: float) -> float:
        return float(eval(compiled, {"__builtins__": {}}, {**namespace, "x": x}))  # noqa: S307

    return _evaluate
