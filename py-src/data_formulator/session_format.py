# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The version of the session state format the frontend saves and loads.

Mirrors ``DF_STATE_VERSION`` in ``src/app/stateMigrations.ts`` (a test keeps them equal), so
Python that writes sessions, such as a demo's build script, can stamp them with it.
"""

SESSION_STATE_VERSION = 14
