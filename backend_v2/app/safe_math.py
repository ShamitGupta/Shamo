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
import re
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


def _check_node(node: ast.AST, var_name: str) -> None:
    if isinstance(node, ast.Expression):
        _check_node(node.body, var_name)
        return
    if isinstance(node, ast.BinOp) and isinstance(node.op, _ALLOWED_BINOPS):
        _check_node(node.left, var_name)
        _check_node(node.right, var_name)
        return
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, _ALLOWED_UNARYOPS):
        _check_node(node.operand, var_name)
        return
    if isinstance(node, ast.Call):
        if (
            not isinstance(node.func, ast.Name)
            or node.func.id not in _ALLOWED_FUNCS
            or node.keywords
        ):
            raise UnsafeExpressionError("only plain calls to a fixed set of math functions are allowed")
        for arg in node.args:
            _check_node(arg, var_name)
        return
    if isinstance(node, ast.Name):
        if node.id != var_name and node.id not in _ALLOWED_NAMES:
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


def _parse(expr: str, var_name: str = "x") -> ast.Expression:
    # var_name is only ever a fixed literal a scene template hardcodes in
    # its own call (e.g. "t" for kinematics_motion) -- never model-supplied
    # -- but it is asserted sane anyway as a guard against a future caller
    # passing something careless, not because it is untrusted input.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", var_name) or var_name in _ALLOWED_NAMES:
        raise ValueError(f"var_name is not usable as a bare expression variable: {var_name!r}")
    if not expr or len(expr) > MAX_EXPRESSION_LENGTH:
        raise UnsafeExpressionError("expression is empty or too long")
    try:
        tree = ast.parse(_normalize(expr), mode="eval")
    except SyntaxError as error:
        raise UnsafeExpressionError(f"could not parse expression: {error}") from error
    _check_node(tree, var_name)
    return tree


def validate_expression(expr: str, var_name: str = "x") -> None:
    """Raise UnsafeExpressionError if expr is anything but bounded arithmetic
    in the single variable var_name (default "x")."""

    _parse(expr, var_name)


def make_evaluator(expr: str, var_name: str = "x") -> Callable[[float], float]:
    """Validate expr, then return a fast f(var_name) closure over it.

    Re-validates even if the caller already did, because a closure that
    outlives the validation call site is exactly the kind of thing that gets
    reused somewhere the check was skipped.

    var_name defaults to "x" so every existing call site is unaffected; a
    template describing a different free variable (e.g. kinematics_motion's
    "t") passes it explicitly. The whitelist grammar itself never changes --
    only which single bare identifier counts as the free variable does.
    """

    tree = _parse(expr, var_name)
    compiled = compile(tree, "<safe-expr>", "eval")
    namespace = {**_ALLOWED_FUNCS, **_ALLOWED_NAMES}

    def _evaluate(value: float) -> float:
        return float(eval(compiled, {"__builtins__": {}}, {**namespace, var_name: value}))  # noqa: S307

    return _evaluate
