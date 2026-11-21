# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Share images (see data_formulator/shares.py): upload one, and the phone page and image its QR code leads to."""

from __future__ import annotations

import base64
import html
import json
import secrets
from urllib.parse import quote

from flask import Blueprint, Response, request, send_file

from data_formulator import shares
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

shares_bp = Blueprint("shares", __name__)

PNG_URL_PREFIX = "data:image/png;base64,"


def _space_name(space: str) -> str:
    from data_formulator.spaces import space_profile
    return str((space_profile(space) or {}).get("name") or "") if space else ""


def _caption(title: str, space: str) -> str:
    """The words posted with the image: its title, where it was made, and the space's hashtags."""
    from data_formulator.spaces import space_profile
    hashtags = str(((space_profile(space) or {}).get("share") or {}).get("hashtags") or "") if space else ""
    made = f"Made with {_space_name(space) or 'Data Formulator'}"
    return " ".join(part for part in (f"{title} · {made}" if title else made, hashtags) if part)


@shares_bp.route("/api/shares", methods=["POST"])
def create_share():
    """Store a share image; returns its id and the page's path."""
    if not shares.shares_available():
        raise AppError(ErrorCode.ACCESS_DENIED, "Sharing to the web is available on hosted Data Formulator.")
    from data_formulator.auth.identity import get_identity_id
    from data_formulator.spaces import current_space
    body = request.get_json(silent=True) or {}
    image = body.get("image")
    if not isinstance(image, str) or not image.startswith(PNG_URL_PREFIX):
        raise AppError(ErrorCode.INVALID_REQUEST, "Send the share image as a PNG data URL.")
    try:
        png = base64.b64decode(image[len(PNG_URL_PREFIX):], validate=True)
    except ValueError:
        raise AppError(ErrorCode.INVALID_REQUEST, "The share image is not valid base64.") from None
    space = current_space() or ""
    title = str(body.get("title") or "")
    try:
        record = shares.create(png, title=title, caption=_caption(" ".join(title.split()), space), space=space,
                               owner=get_identity_id())
    except PermissionError as exc:
        raise AppError(ErrorCode.ACCESS_DENIED, str(exc)) from None
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from None
    return json_ok({"id": record["id"], "path": f"/s/{record['id']}", "expires": record["expires"]})


def _origin() -> str:
    """This server as the visitor reached it (behind a proxy, as the proxy says)."""
    proto = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() or "https"
    host = request.headers.get("X-Forwarded-Host", request.host).split(",")[0].strip()
    return f"{proto}://{host}"


def _missing() -> Response:
    page = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
            "content=\"width=device-width,initial-scale=1\"><title>Share not found</title></head><body style=\"font-family:"
            "system-ui,sans-serif;padding:32px;color:#333\"><h1 style=\"font-size:20px\">This share has expired</h1>"
            "<p>Shared images are kept for a while, then removed.</p><p><a href=\"/\">Open Data Formulator</a></p></body></html>")
    return Response(page, status=404, mimetype="text/html")


@shares_bp.route("/s/<share_id>.png", methods=["GET"])
def share_image(share_id: str):
    # A plain 404, not the API's error envelope: browsers and link previews read the status. Shares are not
    # served while sharing to the web is off.
    found = shares.load(share_id) if shares.shares_available() else None
    if found is None:
        return Response("Share not found.", status=404, mimetype="text/plain")
    return send_file(found[1], mimetype="image/png", max_age=86400)


@shares_bp.route("/s/<share_id>", methods=["GET"])
def share_page(share_id: str):
    """The page a share's QR code opens on a phone: the image and ways to post it."""
    found = shares.load(share_id) if shares.shares_available() else None
    if found is None:
        return _missing()
    record, _ = found
    origin = _origin()
    url = f"{origin}/s/{record['id']}"
    image_url = f"{url}.png"
    space = record.get("site") or ""
    space_url = f"{origin}/space/{quote(space)}" if space else f"{origin}/"
    space_name = _space_name(space) or "Data Formulator"
    title = record.get("title") or space_name
    caption = record.get("caption") or ""
    # Shares made before sizes were kept were all wide cards (1200×630).
    width = int(record.get("width") or 1200)
    height = int(record.get("height") or 630)
    nonce = secrets.token_urlsafe(16)
    e = lambda value: html.escape(str(value), quote=True)  # noqa: E731
    data = json.dumps({"url": url, "image": image_url, "caption": caption, "title": title,
                       "file": f"{record['id']}.png"}).replace("<", "\\u003c")
    text = quote(caption)
    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(caption)}">
<meta property="og:type" content="website"><meta property="og:url" content="{e(url)}">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(caption)}">
<meta property="og:image" content="{e(image_url)}"><meta property="og:image:alt" content="{e(title)}">
<meta property="og:image:width" content="{width}"><meta property="og:image:height" content="{height}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(caption)}"><meta name="twitter:image" content="{e(image_url)}">
<style nonce="{nonce}">
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
background:#f5f6f8;color:#1b1f3b}}main{{max-width:560px;margin:0 auto;padding:16px 16px 40px}}
img{{display:block;width:100%;height:auto;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.12);background:#fff}}
.caption{{margin:14px 2px 18px;font-size:15px;line-height:1.45}}
button,a.btn{{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0 0 10px;
border-radius:10px;border:1px solid #d0d4dc;background:#fff;color:#1b1f3b;font:600 16px/1 inherit;text-decoration:none;cursor:pointer}}
.primary{{background:#2f5bea;border-color:#2f5bea;color:#fff}}.row{{display:flex;gap:10px}}.row>*{{flex:1}}
.try{{display:block;margin:22px 2px 0;font-size:15px;color:#2f5bea;text-decoration:none;font-weight:600}}
footer{{margin-top:28px;font-size:12px;color:#8a8fa3}}
</style></head><body><main>
<img src="{e(image_url)}" alt="{e(title)}" width="{width}" height="{height}">
<p class="caption" id="caption">{e(caption)}</p>
<button id="share" class="primary" type="button">Share…</button>
<div class="row">
<a class="btn" href="https://twitter.com/intent/tweet?text={text}&url={quote(url, safe='')}" target="_blank" rel="noopener">Post on X</a>
<a class="btn" href="https://www.linkedin.com/sharing/share-offsite/?url={quote(url, safe='')}" target="_blank" rel="noopener">LinkedIn</a>
</div>
<div class="row">
<a class="btn" href="{e(image_url)}" download="{e(record['id'])}.png">Save image</a>
<button id="copy" type="button">Copy caption</button>
</div>
<a class="try" href="{e(space_url)}">Try it yourself: {e(space_name)} →</a>
<footer>Shared from {e(space_name)}. Shares are removed after a while.</footer>
</main>
<script nonce="{nonce}">
(function () {{
  var data = {data};
  var text = data.caption + " " + data.url;
  function copy(button) {{
    var done = function () {{ button.textContent = "Copied"; setTimeout(function () {{ button.textContent = button.dataset.label; }}, 1500); }};
    button.dataset.label = button.dataset.label || button.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {{}});
  }}
  var share = document.getElementById("share");
  share.addEventListener("click", function () {{
    fetch(data.image).then(function (r) {{ return r.blob(); }}).then(function (blob) {{
      var file = new File([blob], data.file, {{ type: "image/png" }});
      if (navigator.canShare && navigator.canShare({{ files: [file] }})) return navigator.share({{ files: [file], text: text }});
      if (navigator.share) return navigator.share({{ title: data.title, text: data.caption, url: data.url }});
      copy(share);
    }}).catch(function () {{}});
  }});
  document.getElementById("copy").addEventListener("click", function (event) {{ copy(event.currentTarget); }});
}})();
</script></body></html>"""
    response = Response(page, mimetype="text/html")
    response.headers["Content-Security-Policy"] = (
        f"default-src 'none'; img-src 'self'; connect-src 'self'; style-src 'nonce-{nonce}'; "
        f"script-src 'nonce-{nonce}'; base-uri 'none'; form-action 'none'")
    response.headers["Cache-Control"] = "public, max-age=300"
    return response
