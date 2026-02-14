# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Abstract base class for code-execution sandboxes.

Every sandbox backend must subclass :class:`Sandbox` and implement
:meth:`run_python_code`.  The return contract is a dict with:

* ``{'status': 'ok', 'content': <pandas.DataFrame>}``  on success
* ``{'status': 'error', 'content': '<error message>'}`` on failure
"""

from abc import ABC, abstractmethod

import pandas as pd


class Sandbox(ABC):
    """Base class for sandbox execution backends."""

    @abstractmethod
    def run_python_code(
        self,
        code: str,
        workspace,
        output_variable: str,
    ) -> dict:
        """Execute a Python script and return the resulting DataFrame.

        The script runs with the workspace directory as its working
        directory (read-only).  Scripts can therefore read files directly
        via e.g. ``pd.read_csv("file.csv")``.

        Parameters
        ----------
        code : str
            Python source code to execute.  The script is expected to
            populate a variable named *output_variable* with a
            :class:`pandas.DataFrame`.
        workspace
            A :class:`~data_formulator.datalake.workspace.Workspace`
            instance.  The sandbox reads ``workspace._path`` to set up
            the execution environment.
        output_variable : str
            Name of the variable in *code* that holds the result.

        Returns
        -------
        dict
            ``{'status': 'ok', 'content': DataFrame}``  on success, or
            ``{'status': 'error', 'content': str}``    on failure.
        """
        ...
