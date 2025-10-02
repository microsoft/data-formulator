# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

def run_app():
    """Launch the Data Formulator Flask application."""
    # Import app only when actually running to avoid side effects
    from data_formulator.app import run_app as _run_app
    return _run_app()

__all__ = [
    "run_app",
]