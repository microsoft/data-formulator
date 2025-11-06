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
        'itertools', 'functools', 'operator', 'sklearn', 'time'
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


def run_transform_in_sandbox2020(code, df_list, exec_python_in_subprocess=False):
    
    allowed_objects = {
        'df_list': df_list,
        'output_df': None
    }

    assemble_code = f'''
import pandas as pd
import json
{code}
output_df = transform_data(*df_list)
'''

    if exec_python_in_subprocess:
        result = run_in_subprocess(assemble_code, allowed_objects)
    else:
        result = run_in_main_process(assemble_code, allowed_objects)

    if result['status'] == 'ok':
        result_df = result['allowed_objects']['output_df']
        return {
            'status': 'ok',
            'content': result_df
        }
    else:
        return {
            'status': 'error',
            'content': result['error_message']
        }


def run_derive_concept(code, output_field_name, table_rows, exec_python_in_subprocess=False):
    """given a concept derivation function, execute the function on inputs to generate a new dataframe"""
    
    assemble_code = f'''
import pandas as pd
{code}
new_column = derive_new_column(df)
'''

    allowed_objects = {
        'df': pd.DataFrame.from_records(table_rows),
        'new_column': None # the return value of the derive_new_column function
    }

    if exec_python_in_subprocess:
        result = run_in_subprocess(assemble_code, allowed_objects)
    else:
        result = run_in_main_process(assemble_code, allowed_objects)

    if result['status'] == 'ok':
        result_df = result['allowed_objects']['df']
        result_df[output_field_name] = result['allowed_objects']['new_column']
        return { 'status': 'ok', 'content': result_df }
    else:
        return { 'status': 'error', 'content': result['error_message'] }