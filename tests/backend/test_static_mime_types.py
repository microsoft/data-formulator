# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Regression test: modern image formats must resolve to correct MIME types.

Minimal container base images (e.g. ``python:3.11-slim``) often ship an
incomplete ``/etc/mime.types`` database that has no entry for newer image
formats. When that happens, ``mimetypes.guess_type()`` returns ``None`` for
files like ``*.webp``, and Flask's static file serving falls back to
``application/octet-stream``. Browsers refuse to render an ``<img>`` whose
response declares that generic content-type, even though the HTTP status is
200 and the bytes are correct — this is exactly what produced the "broken
demo thumbnail images" symptom on a fresh deployment.

``data_formulator.app`` explicitly registers these types at import time
(mirroring the pre-existing ``.js``/``.mjs`` registration for the same class
of base-image gap). This test guards that registration.
"""

from __future__ import annotations

import mimetypes

import pytest

pytestmark = [pytest.mark.backend]


def test_webp_and_avif_mime_types_registered():
    # Import triggers the module-level mimetypes.add_type() calls.
    import data_formulator.app  # noqa: F401

    assert mimetypes.guess_type("thumbnail.webp")[0] == "image/webp"
    assert mimetypes.guess_type("thumbnail.avif")[0] == "image/avif"
