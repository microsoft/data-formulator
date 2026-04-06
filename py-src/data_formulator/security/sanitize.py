# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared helpers for sanitizing error messages before they reach the client."""

import html
import re


def sanitize_error_message(error_message: str) -> str:
    """Sanitize error messages before sending to client.

    Strips stack traces, file paths, API keys, and other potentially
    sensitive implementation details so that only a human-readable
    summary is returned to the browser.
    """
    message = html.escape(error_message)

    # Remove API keys / tokens
    message = re.sub(
        r'(api[-_]?key|api[-_]?token)[=:]\s*[^\s&]+',
        r'\1=<redacted>', message, flags=re.IGNORECASE,
    )

    # Strip Python stack-trace blocks ("Traceback (most recent call last): ...")
    message = re.sub(
        r'Traceback \(most recent call last\):.*?(?=\w+Error:|\w+Exception:|\Z)',
        '', message, flags=re.DOTALL | re.IGNORECASE,
    )

    # Strip individual "File "/path/...", line N" references
    message = re.sub(r'File\s+"[^"]+",\s+line\s+\d+[^\n]*', '', message)

    # Strip Unix-style absolute paths (/home/..., /opt/..., etc.)
    message = re.sub(
        r'(?<!\w)/(?:home|opt|usr|tmp|var|etc|srv|root|app|workspace)[/\\]\S+',
        '<path>', message,
    )

    # Strip Windows-style absolute paths (C:\..., D:\..., etc.)
    message = re.sub(r'[A-Za-z]:[/\\]{1,2}\S+', '<path>', message)

    # Collapse successive blank lines left after stripping
    message = re.sub(r'\n{3,}', '\n\n', message).strip()

    if len(message) > 500:
        message = message[:500] + "..."

    return message
