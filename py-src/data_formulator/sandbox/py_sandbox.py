# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from multiprocessing import Process, Pipe
from sys import addaudithook
import traceback
import warnings
import pandas as pd

def subprocess_execute(code, allowed_objects, conn):
    """run the code in a subprocess with some sort of safety measure
    code: script to execute
    allowed_objects: objects exposed to the target code
    conn: children connection
    """
    warnings.filterwarnings('ignore')

    def block_mischief(event,arg):
        if type(event) != str: raise
        # Security note: Well-designed objects can be passed to this function that could expose the top-level namespace 
        # (through catching error and reading sys.exc_info()[2].tb_frame.f_back.f_globals). This should not enable modifying 
        # variables outside the multiprocessing sandbox, but could give access to some internal sandbox variables. This function
        # thus should not refer to any 'lock variables'. It is safer to check the results in the main thread.
        if event=='open' and type(arg[1])==str and arg[1]!='r': 
            print('\taudit:', event, arg)
            raise IOError('file write forbidden')
        if event.split('.')[0] in ['subprocess', 'shutil', 'winreg']: 
            print('\taudit:', event, arg)
            raise IOError('potentially dangerous, filesystem-accessing functions forbidden')

    addaudithook(block_mischief)
    del(block_mischief)  ## No way to remove or circumwent audit hooks from python. No access to this function. 

    extended_allowed_objects = { **allowed_objects, 'conn': conn }  # automatically add the communication pipe to objects accessible from the sandbox
    try:
        exec(code, extended_allowed_objects)
    except Exception as err:
        error_message = f"Error: {type(err).__name__} - {str(err)}"
        conn.send({'status': 'error', 'error_message': error_message})
        conn.close()
        return {key: extended_allowed_objects[key] for key in allowed_objects}

    conn.send({'status': 'ok', 'allowed_objects': {key: extended_allowed_objects[key] for key in allowed_objects}})
    conn.close()


def run_in_subprocess(code, allowed_objects):
    sandbox_locals = { **allowed_objects }
    parent_conn, child_conn = Pipe()
    p = Process(target=subprocess_execute, args=(code, sandbox_locals, child_conn))
    p.start()

    ## NOTE: The sandbox is probably safe against file writing, as well as against access into the main process.
    ## Yet the objects returned from it as results could have been manipulated. Asserting the output objects to be 
    ## of expected data types is an extra safety measure. But be careful whenever your main program flow is 
    ## controlled by the returned objects' attributes, e.g. file paths could change. 
    result = parent_conn.recv()
    p.join()
    return result


def run_in_main_process(code, allowed_objects):
    """run the code in the main process with some sort of safety measure, 
        faster than subprocess, but may crash the main process if the code is malicious
    code: script to execute
    allowed_objects: objects exposed to the target code
    """
    warnings.filterwarnings('ignore')

    # Create a restricted builtins dictionary with only safe operations
    safe_builtins = {}
    for name in ['abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
                 'callable', 'chr', 'complex', 'dict', 'divmod', 'enumerate', 'filter', 'float',
                 'format', 'frozenset', 'getattr', 'hasattr', 'hash', 'hex', 'id', 'int', 'isinstance',
                 'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object', 'oct', 'ord', 'pow',
                 'range', 'repr', 'reversed', 'round', 'set', 'slice', 'sorted', 'str', 'sum', 'tuple',
                 'type', 'zip', '__import__', 'Exception']:  # Note: we need __import__ for importing allowed modules
        if name in __builtins__:
            safe_builtins[name] = __builtins__[name]

    # List of allowed modules for import
    ALLOWED_MODULES = {
        'pandas', 'numpy', 'math', 'datetime', 'json',
        'statistics', 'random', 'collections', 're',
        'itertools', 'functools', 'operator', 'sklearn', 'scipy', 'time',
        'duckdb'  # Added for unified Python+SQL execution
    }

    # Custom import function that only allows safe modules and their submodules
    def safe_import(name, *args, **kwargs):
        # Check if the top-level module is allowed
        top_level_module = name.split('.')[0]
        if top_level_module not in ALLOWED_MODULES:
            raise ImportError(f"Import of module '{name}' is not allowed for security reasons. "
                           f"Allowed modules are: {', '.join(sorted(ALLOWED_MODULES))}")
        return __import__(name, *args, **kwargs)

    # Override the builtin __import__
    safe_builtins['__import__'] = safe_import

    # Create restricted globals with only necessary modules and objects
    restricted_globals = {
        '__builtins__': safe_builtins,
        **allowed_objects
    }

    try:
        exec(code, restricted_globals)
    except Exception as err:
        error_message = f"Error: {type(err).__name__} - {str(err)}"
        return {'status': 'error', 'error_message': error_message}

    return {'status': 'ok', 'allowed_objects': {key: restricted_globals[key] for key in allowed_objects}}


# Lock to serialize os.chdir in the main-process path.
# os.chdir is process-global, so concurrent threads would race on it.
import threading
_chdir_lock = threading.Lock()


def run_unified_transform_in_sandbox(
    code: str,
    workspace_path: str,
    output_variable: str,
    exec_python_in_subprocess: bool = False
) -> dict:
    """
    Execute Python script with DuckDB and pandas in workspace directory.
    This is used by the unified agent that generates Python scripts combining SQL and pandas.

    Args:
        code: Python script to execute (not a function, just a script)
        workspace_path: Path to workspace directory (script will run with this as cwd)
        output_variable: Name of variable containing result DataFrame
        exec_python_in_subprocess: Whether to use subprocess execution

    Returns:
        dict with status='ok'/'error' and content=DataFrame or error message
    """
    import os

    # Prepend an os.chdir() call into the executed code itself so that:
    #   - In subprocess mode, the child process changes its own cwd (no race).
    #   - In main-process mode, we still rely on os.chdir but protect it with
    #     a lock so concurrent requests don't stomp on each other's cwd.
    workspace_path_escaped = str(workspace_path).replace("\\", "\\\\").replace("'", "\\'")
    chdir_preamble = f"import os as _sandbox_os; _sandbox_os.chdir('{workspace_path_escaped}')\n"
    code_with_chdir = chdir_preamble + code

    try:
        allowed_objects = {
            output_variable: None  # Will be populated by script
        }

        if exec_python_in_subprocess:
            # Subprocess: the child gets its own process-global cwd — no race.
            result = run_in_subprocess(code_with_chdir, allowed_objects)
        else:
            # Main-process: serialise the chdir+exec to avoid cwd races
            # between concurrent Flask threads.
            original_cwd = os.getcwd()
            with _chdir_lock:
                try:
                    os.chdir(workspace_path)
                    result = run_in_main_process(code, allowed_objects)
                finally:
                    os.chdir(original_cwd)

        if result['status'] == 'ok':
            output_df = result['allowed_objects'][output_variable]

            # Validate output is a DataFrame
            if not isinstance(output_df, pd.DataFrame):
                return {
                    'status': 'error',
                    'content': f'Output variable "{output_variable}" is not a DataFrame (type: {type(output_df).__name__})'
                }

            return {
                'status': 'ok',
                'content': output_df
            }
        else:
            return result

    except Exception as e:
        return {
            'status': 'error',
            'content': f"Error during execution setup: {type(e).__name__} - {str(e)}"
        }
