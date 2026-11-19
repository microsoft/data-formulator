# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The workspace skill's ``view``, back into the run.

``view`` pauses the run with a ``view_request`` (the charts, maps and apps to draw). The user's browser draws them
as the user sees them and resumes the run with a ``view_response``: one result per item, a PNG or why it could not
be drawn. This turns that response into the user message the run continues from, the pictures attached.
"""

from __future__ import annotations

import re
from typing import Any

from data_formulator.analyst.skills.workspace.skill import VIEW_LIMIT

# A picture's data URL, at most about 3 MB of image.
MAX_IMAGE_CHARS = 4_000_000
_IMAGE_URL = re.compile(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}")


def _clip(value: Any, limit: int = 300) -> str:
    return str(value).replace("\n", " ").strip()[:limit]


def view_resume_message(response: Any, trajectory: Any, *, other_responses: tuple[Any, ...] = ()) -> dict[str, Any]:
    """The user message a run resumes from after ``view``; raises ``ValueError`` for a malformed response."""
    if (not isinstance(response, dict) or not isinstance(trajectory, list) or not trajectory
            or any(other is not None for other in other_responses)):
        raise ValueError("A view response resumes a paused run, on its own.")
    results = response.get("results")
    if not isinstance(results, list) or not 1 <= len(results) <= VIEW_LIMIT:
        raise ValueError(f"A view response holds 1 to {VIEW_LIMIT} results.")
    lines: list[str] = []
    images: list[str] = []
    for item in results:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("Each view result names its path.")
        image = item.get("image")
        if isinstance(image, str) and len(image) <= MAX_IMAGE_CHARS and _IMAGE_URL.fullmatch(image):
            images.append(image)
            lines.append(f"- {_clip(item['path'])}: picture {len(images)} below")
        else:
            lines.append(f"- {_clip(item['path'])}: not drawn ({_clip(item.get('error') or 'the browser could not draw it')})")
    problems = response.get("problems")
    lines += [f"- {_clip(problem)}" for problem in (problems if isinstance(problems, list) else [])[:2 * VIEW_LIMIT]
              if isinstance(problem, str)]
    text = ("[VIEWED] The application drew the items you asked to view, as the user sees them:\n" + "\n".join(lines)
            + "\n\nLook at the pictures and continue the task. View an item again only after you change it.")
    return {"role": "user", "content": [{"type": "text", "text": text},
                                        *({"type": "image_url", "image_url": {"url": url, "detail": "high"}}
                                          for url in images)]}
