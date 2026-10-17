"""Setup-form artifacts shared by every configure action.

Each configure action ends in the same artifact: a typed, prefilled form the
user can review and submit in the canvas. Setup forms pause the turn as an
``interact`` event; a workflow proposal closes the turn as a ``completion``
whose content carries the same ``form`` payload.
The frontend owns submission through the application's existing APIs, so
credentials, session state, and permissions follow the same path as manual
setup. A form may ask to be submitted automatically when the agent is certain;
the frontend still validates it and leaves it open for review on failure.
A form revising an existing item names it as ``target`` ({id, name}); the user
chooses to update that item or save a new one.
"""

from __future__ import annotations

from typing import Any

from data_formulator.analyst.skills.base import Event, SkillContext

FORM_KINDS = ("connector", "schedule", "sessions", "workflow")


def identity_of(ctx: SkillContext) -> str:
    """Return the application identity whose setup is being managed.

    Uses the app's own resolver (auth provider, single-user local, or anonymous
    browser identity) when a request is active; otherwise the identity the route
    resolved the same way for this run. Either must own the run's workspace, so
    setup tools never reach another user's sessions, workflows, or schedules.
    """
    from flask import has_request_context

    identity = None
    if has_request_context():
        from data_formulator.auth.identity import get_identity_id
        try:
            identity = get_identity_id()
        except ValueError:
            identity = None
    identity = identity or ctx.payload.get("identity_id")
    owner = getattr(ctx.workspace, "identity_id", None)
    identity = identity or owner
    if not isinstance(identity, str) or not identity:
        raise ValueError("Setup management needs the current user's identity; sign in or reload the app and try again.")
    if isinstance(owner, str) and owner and owner != identity:
        raise ValueError("The active workspace does not belong to the current user.")
    return identity


def review_requested(spec: dict[str, Any]) -> bool:
    """Read ``user_review_needed``; review is the default for setup changes."""
    value = spec.get("user_review_needed", True)
    if not isinstance(value, bool):
        raise ValueError("user_review_needed must be a boolean")
    return value


def form_payload(kind: str, *, title: str, body: dict[str, Any], **extra: Any) -> dict[str, Any]:
    if kind not in FORM_KINDS:
        raise ValueError(f"Unknown setup form kind: {kind}")
    return {"kind": kind, **extra, "title": title, kind: body}


def form_event(
    kind: str,
    ctx: SkillContext,
    *,
    title: str,
    body: dict[str, Any],
    default_response: str,
    auto_submit: bool = False,
    thought: str = "",
    **extra: Any,
) -> Event:
    response = str(ctx.payload.get("action_narration") or "").strip()
    return {
        "type": "interact",
        **({"thought": thought} if thought else {}),
        "form": {
            **form_payload(kind, title=title, body=body, **extra),
            "response": response or default_response,
            "auto_submit": auto_submit,
        },
    }
