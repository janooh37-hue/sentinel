"""Audit which /api/v1 routes carry an authorization gate.

Three enforcement layers exist:
  1. `main.py` mounts most routers with `dependencies=[Depends(get_current_user)]`
     -- baseline "must be logged in". Not authorization.
  2. `Depends(require_capability("x.y"))` / `Depends(require_admin)` in the route
     signature or the router's `dependencies=` -- declarative authorization.
  3. An in-handler `perm_service.has_capability(...)` check -- imperative
     authorization, used where the required capability depends on runtime state
     (e.g. `documents.py` picks `books.view` vs `documents.generate` based on
     whether the document is signature-locked).

A route protected only by layer 1 is callable by ANY authenticated user. Some of
those are correct by design (self-scoped `/me*`, login, push subscribe, pre-login
probes); the point of this report is to make the set explicit and reviewable.

Run: python backend/scripts/audit_capability_gates.py
Exit 0 always -- this is a report, not a CI gate.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

V1 = Path(__file__).resolve().parents[1] / "app" / "api" / "v1"
GATES = ("require_capability", "require_admin")
INBODY_GATES = ("has_capability",)
SESSION_DEPS = ("get_current_user",)
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options", "api_route"}


def _gate_names(node: ast.AST, names: tuple[str, ...] = GATES) -> list[str]:
    """Every gate helper in `names` referenced anywhere inside `node`."""
    found = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and sub.id in names:
            found.append(sub.id)
        elif isinstance(sub, ast.Attribute) and sub.attr in names:
            found.append(sub.attr)
    return found


def _route_decorators(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Call]:
    out = []
    for dec in fn.decorator_list:
        if not isinstance(dec, ast.Call):
            continue
        f = dec.func
        if isinstance(f, ast.Attribute) and f.attr in HTTP_METHODS:
            out.append(dec)
    return out


def _path_of(dec: ast.Call) -> str:
    if dec.args and isinstance(dec.args[0], ast.Constant):
        return str(dec.args[0].value)
    return "?"


def _method_of(dec: ast.Call) -> str:
    f = dec.func
    assert isinstance(f, ast.Attribute)
    if f.attr != "api_route":
        return f.attr.upper()
    for kw in dec.keywords:
        if kw.arg == "methods":
            try:
                return ",".join(ast.literal_eval(kw.value))
            except (ValueError, SyntaxError):
                return "api_route"
    return "api_route"


def _router_level_gates(tree: ast.Module) -> list[str]:
    """Gates attached to `APIRouter(dependencies=[...])` in this module."""
    gates = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
        if name != "APIRouter":
            continue
        for kw in node.keywords:
            if kw.arg == "dependencies":
                gates.extend(_gate_names(kw.value))
    return gates

def _authenticated_modules() -> set[str]:
    """Module basenames whose routers are mounted WITH the baseline auth gate.

    `main.py` builds `auth_gate = [Depends(get_current_user)]` and passes it as
    `dependencies=` on most `include_router` calls. Routers mounted without it
    (`system`, `auth`, the WebDAV router) are reachable anonymously, so their
    ungated routes are a strictly larger exposure than the merely
    authenticated-only ones.
    """
    main_py = V1.parents[1] / "main.py"  # backend/app/main.py
    tree = ast.parse(main_py.read_text(encoding="utf-8"))

    # `from app.api.v1 import books as books_v1` -> {"books_v1": "books.py"}
    alias_to_module: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "app.api.v1":
            for a in node.names:
                alias_to_module[a.asname or a.name] = f"{a.name}.py"

    gated: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if not (isinstance(f, ast.Attribute) and f.attr == "include_router"):
            continue
        if not node.args:
            continue
        target = node.args[0]
        # `books_v1.router` / `books_v1.categories_router`
        base = target.value if isinstance(target, ast.Attribute) else target
        alias = getattr(base, "id", None)
        module = alias_to_module.get(alias or "")
        if module is None:
            continue
        has_gate = any(
            kw.arg == "dependencies" and "auth_gate" in ast.dump(kw.value)
            for kw in node.keywords
        )
        if has_gate:
            gated.add(module)
    return gated



def main() -> int:
    total = 0
    authed_modules = _authenticated_modules()
    inbody: list[tuple[str, str, str, str]] = []
    ungated: list[tuple[str, str, str, str]] = []
    anon: list[tuple[str, str, str, str]] = []
    authed_only: list[tuple[str, str, str, str]] = []
    per_module: dict[str, tuple[int, int]] = {}

    for path in sorted(V1.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        module_gates = _router_level_gates(tree)
        mod_total = mod_ungated = 0

        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            decorators = _route_decorators(fn)
            if not decorators:
                continue

            # Declarative gates sit in the decorator (dependencies=[...]), the
            # signature defaults (Depends(require_capability(...))), or on the
            # router itself. Imperative gates live in the handler body.
            gates = list(module_gates)
            for dec in decorators:
                gates += _gate_names(dec)
            gates += _gate_names(fn.args)
            body_gates = [g for stmt in fn.body for g in _gate_names(stmt, INBODY_GATES)]
            # A handler in a router mounted without `auth_gate` can still demand a
            # session itself -- `auth.py` and `system.py` do exactly that.
            has_session = bool(_gate_names(fn.args, SESSION_DEPS)) or path.name in authed_modules

            for dec in decorators:
                total += 1
                mod_total += 1
                if gates:
                    continue
                entry = (path.name, _method_of(dec), _path_of(dec), fn.name)
                if body_gates:
                    inbody.append(entry)
                else:
                    mod_ungated += 1
                    ungated.append(entry)
                    (authed_only if has_session else anon).append(entry)

        if mod_total:
            per_module[path.name] = (mod_total, mod_ungated)

    print(f"/api/v1 routes: {total}")
    print(f"  dependency-gated (require_capability / require_admin): "
          f"{total - len(inbody) - len(ungated)}")
    print(f"  in-handler gated (perm_service.has_capability):        {len(inbody)}")
    print(f"  authenticated-only (login, but no capability):         {len(authed_only)}")
    print(f"  anonymous (no session required at all):                {len(anon)}\n")

    print("In-handler gated (correct, but invisible to a signature-only audit):")
    for mod, method, route, fn in inbody:
        print(f"  {method:<14} {route:<44} {mod}::{fn}")

    print("\nAnonymous — reachable without any session:")
    for mod, method, route, fn in anon:
        print(f"  {method:<14} {route:<44} {mod}::{fn}")

    print("\nModules with authenticated-only routes:")
    for name, (t, u) in sorted(per_module.items(), key=lambda kv: -kv[1][1]):
        if u and name in authed_modules:
            print(f"  {name:<24} {u}/{t}")

    print("\nAuthenticated-only — any logged-in user, regardless of capability:")
    for mod, method, route, fn in authed_only:
        print(f"  {method:<14} {route:<44} {mod}::{fn}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
