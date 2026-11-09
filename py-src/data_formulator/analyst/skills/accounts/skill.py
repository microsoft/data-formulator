# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Accounts skill: ``api_fetch`` as the user, and ``propose_signin`` when a service needs a sign-in (design-docs/72).

``api_fetch`` reads only, and only from hosts a sign-in spec names (a built-in one, or one the user saved), so it runs
without approval like probing a connected source; the secret stays on the server (``accounts.store``).
``propose_signin`` pauses the run on a ``signin`` setup form for a built-in service or a spec the agent writes. The
spec is validated here (one site, exact public hosts, a known way to send the secret) and shown to the user, who
confirms it by saving a key; the agent supplies only the explanation, the app draws the controls.
"""

from __future__ import annotations

import json
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult

MAX_STEPS = 3


def _scope() -> tuple[str, str | None]:
    """The user, and the session the request comes from (outside a request, none: session sign-ins do not apply)."""
    from flask import has_request_context

    from data_formulator.auth.identity import get_identity_id
    from data_formulator.workspace_factory import get_active_workspace_id

    identity = get_identity_id()
    if not identity:
        raise ValueError("A local identity is required to reach services as the user.")
    return identity, (get_active_workspace_id() or None) if has_request_context() else None


def _fetch(args: dict[str, Any], ctx: SkillContext) -> dict[str, Any]:
    from data_formulator.accounts import accounts_available, store
    from data_formulator.accounts.fetch import api_fetch
    from data_formulator.accounts.specs import host_of

    if not accounts_available():
        raise ValueError("api_fetch is available only in the single-user local app.")
    identity, workspace = _scope()
    url = str(args.get("url") or "").strip()
    spec = store.spec_for_host(identity, host_of(url), workspace)
    if spec is None:
        raise ValueError(f"No sign-in or built-in service covers {host_of(url) or url[:120]!r}. Fetch public data with "
                         "the terminal; if the service needs a key, offer a sign-in with propose_signin and a spec.")
    from data_formulator.accounts import activity

    found = store.credential(identity, spec.id, workspace)
    secret, login = (found[1], found[2]) if found else (None, None)
    result = api_fetch(url, spec=spec, secret=secret, login=login, scratch_root=ctx.workspace.confined_scratch.root,
                       save_as=args.get("save_as"))
    if secret:
        activity.record("used", spec, workspace=workspace, url=activity.where(url), status=result.get("status"),
                        account=login, served_from=result.get("served_from"), failed=bool(result.get("error")) or None)
    return result


def _text(value: Any, limit: int, field: str, required: bool = False) -> str:
    text = " ".join(str(value or "").split())
    if required and not text:
        raise ValueError(f"{field} is required.")
    if len(text) > limit:
        raise ValueError(f"{field} must be at most {limit} characters.")
    return text


def signin_form(spec_args: dict[str, Any], identity: str, workspace: str | None = None) -> tuple[str, dict[str, Any]]:
    """The card's title (the app's) and body: the spec (built-in, or the agent's, checked), the agent's explanation
    and steps (checked), and the sign-in's live state."""
    from data_formulator.accounts import store
    from data_formulator.accounts.specs import REASONS, builtin, on_domains, validate_spec

    if spec_args.get("provider") and spec_args.get("spec"):
        raise ValueError("Give provider (a built-in service) or spec (any other service), not both.")
    if spec_args.get("provider"):
        spec = builtin(str(spec_args["provider"]))
    elif isinstance(spec_args.get("spec"), dict):
        spec = validate_spec(spec_args["spec"])
    else:
        raise ValueError("Give provider (a built-in service such as 'huggingface') or a spec for any other service.")
    reason = str(spec_args.get("reason") or "")
    if reason not in REASONS:
        raise ValueError(f"reason must be one of {', '.join(REASONS)}.")
    raw_steps = spec_args.get("steps") or []
    if not isinstance(raw_steps, list) or len(raw_steps) > MAX_STEPS:
        raise ValueError(f"steps must be a list of at most {MAX_STEPS}.")
    steps = []
    for step in raw_steps:
        if not isinstance(step, dict):
            raise ValueError("Each step needs text, and optionally a url.")
        url = str(step.get("url") or "").strip()
        if url and not on_domains(url, spec.link_domains):
            raise ValueError(f"Step links must be https pages on {spec.name}'s own site "
                             f"({', '.join(spec.link_domains)}); not {url[:120]!r}.")
        steps.append({"text": _text(step.get("text"), 200, "A step's text", required=True), **({"url": url} if url else {})})
    saved = store.spec_of(identity, spec.id, workspace)
    account = store.state(identity, spec.id, workspace) if saved else None
    methods = account["methods"] if account else list(spec.methods)
    prefer = str(spec_args.get("prefer") or "")
    body = {
        "provider": spec.id, "provider_name": spec.name, "verified": spec.verified, "spec": spec.public(),
        "reason": reason, "explanation": _text(spec_args.get("explanation"), 400, "explanation", required=True),
        **({"unlocks": _text(spec_args.get("unlocks"), 160, "unlocks")} if spec_args.get("unlocks") else {}),
        "steps": steps, **({"prefer": prefer} if prefer in methods else {}),
        "signed_in": bool(account and account["signed_in"]),
        **({"login": account["login"]} if account and account["login"] else {}),
        # A different spec under a saved one's name replaces it once the user saves a key.
        **({"replaces": True} if saved and not spec.verified and saved.stored() != spec.stored() else {}),
    }
    return f"Sign in to {spec.name}", body


def propose_signin(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    from data_formulator.accounts import accounts_available
    from data_formulator.analyst.skills.configure.forms import form_event

    if not accounts_available():
        return "Sign-in is available only in the single-user local app."
    try:
        identity, workspace = _scope()
        title, body = signin_form(spec, identity, workspace)
    except ValueError as exc:
        return f"propose_signin failed: {exc}"
    yield form_event("signin", ctx, title=title, body=body,
                     default_response=f"Signing in to {body['provider_name']} would let me continue.")
    return None


class AccountsSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        if name != "api_fetch":
            return ToolResult(text=json.dumps({"error": f"accounts has no tool '{name}'."}))
        try:
            result = _fetch(args or {}, ctx)
        except ValueError as exc:
            result = {"error": str(exc)}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        if action != "propose_signin":
            message = f"accounts has no action '{action}'."
            yield {"type": "error", "message": message, "message_code": "agent.unknownAction"}
            return message
        return (yield from propose_signin(spec or {}, ctx))


def get_skill() -> AccountsSkill:
    return AccountsSkill()
