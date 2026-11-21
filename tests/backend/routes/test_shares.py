"""Share images: upload, the phone page with link-preview tags, the image, and expiry."""

from __future__ import annotations

import base64
import json
import time
from unittest.mock import patch

import pytest
from flask import Flask

from data_formulator import shares
from data_formulator.routes.shares import shares_bp

pytestmark = [pytest.mark.backend]

PNG = shares.PNG_SIGNATURE + (13).to_bytes(4, "big") + b"IHDR" + (2400).to_bytes(4, "big") + (2400).to_bytes(4, "big") + b"\x00" * 17
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()
NEURIPS = {"name": "NeurIPS in Data Formulator", "share": {"hashtags": "#NeurIPS2026"}}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from data_formulator.error_handler import register_error_handlers

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setenv("DF_SHARE_LINKS", "on")
    monkeypatch.setattr(shares, "_recent", {})
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(shares_bp)
    register_error_handlers(app)
    with patch("data_formulator.auth.identity.get_identity_id", return_value="browser:visitor"), \
            patch("data_formulator.spaces.current_space", return_value="neurips"), \
            patch("data_formulator.spaces.space_profile", side_effect=lambda site: NEURIPS if site == "neurips" else None):
        with app.test_client() as test_client:
            yield test_client


def test_a_share_opens_on_a_phone_with_its_image_caption_and_link_preview(client) -> None:
    created = client.post("/api/shares", json={"image": PNG_URL, "title": "Where <NeurIPS> met"}).get_json()["data"]
    assert created["path"] == f"/s/{created['id']}"

    page = client.get(created["path"], headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "demo.example.org"})
    text = page.get_data(as_text=True)
    assert page.status_code == 200
    assert f'<meta property="og:image" content="https://demo.example.org/s/{created["id"]}.png">' in text
    # A square card is shown and previewed square.
    assert '<meta property="og:image:width" content="2400"><meta property="og:image:height" content="2400">' in text
    assert 'width="2400" height="2400"' in text
    assert "Where &lt;NeurIPS&gt; met · Made with NeurIPS in Data Formulator #NeurIPS2026" in text
    assert "<NeurIPS>" not in text
    assert 'href="https://demo.example.org/space/neurips"' in text
    assert "script-src 'nonce-" in page.headers["Content-Security-Policy"]

    image = client.get(f"{created['path']}.png")
    assert image.status_code == 200 and image.data == PNG and image.mimetype == "image/png"


def test_sharing_is_off_on_a_persons_own_computer(client, monkeypatch) -> None:
    monkeypatch.setenv("DF_SHARE_LINKS", "off")
    assert client.post("/api/shares", json={"image": PNG_URL}).get_json()["status"] == "error"


def test_an_administrator_can_turn_sharing_to_the_web_off(client, monkeypatch, tmp_path) -> None:
    share_id = client.post("/api/shares", json={"image": PNG_URL, "title": "Kept"}).get_json()["data"]["id"]
    monkeypatch.delenv("DF_SHARE_LINKS")
    settings = tmp_path / "configuration.json"
    settings.write_text(json.dumps({"version": 1, "revision": 1, "overrides": {"share_links": False}}))
    assert not shares.shares_available() and not shares.share_links_locked()
    # Only sharing from the browser is left: nothing is taken, and links already made stop working.
    assert client.post("/api/shares", json={"image": PNG_URL}).get_json()["status"] == "error"
    assert client.get(f"/s/{share_id}").status_code == 404
    assert client.get(f"/s/{share_id}.png").status_code == 404

    settings.write_text(json.dumps({"version": 1, "revision": 2, "overrides": {"share_links": True}}))
    assert client.get(f"/s/{share_id}").status_code == 200
    # The deployment's setting wins over the administrator's.
    monkeypatch.setenv("DF_SHARE_LINKS", "off")
    assert not shares.shares_available() and shares.share_links_locked()


def test_only_png_images_are_shared(client, tmp_path) -> None:
    not_png = "data:image/png;base64," + base64.b64encode(b"<svg/>").decode()
    assert client.post("/api/shares", json={"image": not_png}).get_json()["error"]["message"] == "A share image is a PNG."
    assert client.post("/api/shares", json={"image": "data:text/html;base64,PGI+"}).get_json()["status"] == "error"
    assert not list((tmp_path / "shares").glob("*")) if (tmp_path / "shares").exists() else True


def test_an_expired_share_is_gone(client, tmp_path) -> None:
    share_id = client.post("/api/shares", json={"image": PNG_URL, "title": "Old"}).get_json()["data"]["id"]
    meta = tmp_path / "shares" / f"{share_id}.json"
    meta.write_text(json.dumps({**json.loads(meta.read_text()), "expires": time.time() - 1}))
    assert client.get(f"/s/{share_id}").status_code == 404
    assert client.get(f"/s/{share_id}.png").status_code == 404
    assert client.get("/s/short").status_code == 404
