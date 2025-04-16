# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from multiprocessing import Process, Pipe
from sys import addaudithook
import traceback
import warnings
import pandas as pd

## ---------------- The sandbox implementation follows, not to be changed --------------------

def ran_in_subprocess(code, allowed_objects, conn, output_var_name):
    """run the code in a subprocess with some sort of safety measure
    code: script to execute
    allowed_objects: objects exposed to the target code
    conn: children connection
    output_var_name: which variable to return from the subprocess
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

    allowed_objects['conn'] = conn  # automatically add the communication pipe to objects accessible from the sandbox
    try:
        exec(code, allowed_objects)
    except Exception as err:
        error_message = f"Error: {type(err).__name__} - {str(err)}"
        conn.send({'status': 'error', 'content': error_message})
        conn.close()
        return allowed_objects

    conn.send({'status': 'ok', 'content': allowed_objects[output_var_name]})
    conn.close()
    return allowed_objects

def run_transform_in_sandbox2020(code, table_list):
    
    allowed_objects = [table_list]

    import_str = "import pandas as pd\nimport json"

    exec_str = '''
output_df = transform_data(*[pd.DataFrame.from_records(data) for data in table_list])
#print(output_df)
output = output_df.to_json(None, "records")
#print(output)
    '''

    script_str = f'{import_str}\n\n{code}{exec_str}'

    sandbox_locals = dict((key, value) for key,value in locals().items() if value in allowed_objects) # copy.deepcopy() ## are all obj safely serialized?
    parent_conn, child_conn = Pipe()
    p = Process(target=ran_in_subprocess, args=(script_str, sandbox_locals, child_conn, 'output'))
    p.start()

    ## NOTE: The sandbox is probably safe against file writing, as well as against access into the main process.
    ## Yet the objects returned from it as results could have been manipulated. Asserting the output objects to be 
    ## of expected data types is an extra safety measure. But be careful whenever your main program flow is 
    ## controlled by the returned objects' attributes, e.g. file paths could change. 
    result = parent_conn.recv()
    p.join()
    return result


def run_data_process_in_sandbox(code, df, exec_str):
    """given a concept derivatino function, execute the function on inputs to generate a new dataframe"""
    
    allowed_objects = [df]

    import_str = "import pandas as pd\nimport json"

    script_str = f'{import_str}\n\n{code}{exec_str}'

    # Use 'is' operator instead of 'in' for exact object identity comparison
    sandbox_locals = dict((key, value) for key, value in locals().items() if any(value is obj for obj in allowed_objects))
    parent_conn, child_conn = Pipe()
    p = Process(target=ran_in_subprocess, args=(script_str, sandbox_locals, child_conn, 'df'))
    p.start()

    result = parent_conn.recv()
    p.join()
    return result


def derive_df_in_sandbox2020(code, output_field_name, table_rows):
    """given a concept derivation function, execute the function on inputs to generate a new dataframe"""
    
    warnings.filterwarnings('ignore')
    
    df = pd.DataFrame.from_records(table_rows)
    
    # Create a restricted builtins dictionary with only safe operations
    safe_builtins = {}
    for name in ['abs', 'all', 'any', 'ascii', 'bin', 'bool', 'bytearray', 'bytes',
                 'chr', 'complex', 'dict', 'divmod', 'enumerate', 'filter', 'float',
                 'format', 'frozenset', 'hash', 'hex', 'int', 'iter', 'len', 'list',
                 'map', 'max', 'min', 'next', 'oct', 'ord', 'pow', 'range', 'repr',
                 'reversed', 'round', 'set', 'slice', 'sorted', 'str', 'sum', 'tuple',
                 'zip', '__import__']:  # Note: we need __import__ for importing allowed modules
        if name in __builtins__:
            safe_builtins[name] = __builtins__[name]

    # List of allowed modules for import
    ALLOWED_MODULES = {
        'pandas', 'numpy', 'math', 'datetime', 'json', 
        'statistics', 'random', 'collections', 're',
        'itertools', 'functools', 'operator'
    }

    # Custom import function that only allows safe modules
    def safe_import(name, *args, **kwargs):
        if name not in ALLOWED_MODULES:
            raise ImportError(f"Import of module '{name}' is not allowed for security reasons. "
                           f"Allowed modules are: {', '.join(sorted(ALLOWED_MODULES))}")
        return __import__(name, *args, **kwargs)

    # Override the builtin __import__
    safe_builtins['__import__'] = safe_import

    # Create restricted globals with only necessary modules and objects
    restricted_globals = {
        '__builtins__': safe_builtins,
        'df': df   # The dataframe to operate on
    }

    try:
        exec_str = f'''
import pandas as pd
{code}
df["{output_field_name}"] = derive_new_column(df)
'''
        exec(exec_str, restricted_globals)
        result = {'status': 'ok', 'content': restricted_globals['df']}
    except Exception as err:
        error_message = f"Error: {type(err).__name__} - {str(err)}"
        result = {'status': 'error', 'content': error_message}

    return result


def derive_df_in_sandbox2020_subprocess(code, output_field_name, table_rows):
    """given a concept derivatino function, execute the function on inputs to generate a new dataframe"""
    
    df = pd.DataFrame.from_records(table_rows)
    exec_str = f'''
df["{output_field_name}"] = derive_new_column(df)
'''
    result = run_data_process_in_sandbox(code, df, exec_str)
    return result