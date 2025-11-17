# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import keyword
import pandas as pd
import numpy as np

import re

def string_to_py_varname(var_str): 
    var_name = re.sub(r'\W|^(?=\d)', '_', var_str)
    if keyword.iskeyword(var_name):
        var_name = f"__{var_name}"
    return var_name

def field_name_to_ts_variable_name(field_name):
    if field_name.strip() == "":
        return "inp"
    clean_name = re.sub('[^A-Za-z0-9]+', ' ', field_name)
    clean_name = re.sub(' +', ' ', clean_name)
    var_name = ''.join(x for x in clean_name.title() if not x.isspace())
    var_name = var_name[0].lower() + var_name[1:]
    return var_name

def infer_ts_datatype(df, name):
    if name not in df.columns:
        return "any"
        
    dtype = df[name].dtype
    if dtype == "object":  
        return "string"  
    elif dtype == "int64" or dtype == "float64":  
        return "number"  
    elif dtype == "bool":  
        return "boolean"  
    elif dtype == "datetime64":  
        return "Date"  
    else:  
        return "any"  

def value_handling_func(val):
    """process values to make it comparable"""
    if isinstance(val, (int,)):
        return val
    try:
        val = float(val)
        val = np.round(val, 5)
    except:
        pass

    if isinstance(val, (list,)):
        return str(val)

    return val

def table_hash(table):
    """hash a table, mostly for the purpose of comparison"""
    if len(table) == 0:
        return hash(table)
    schema = sorted(list(table[0].keys()))
    frozen_table = tuple(sorted([tuple([hash(value_handling_func(r[key])) for key in schema]) for r in table]))
    return hash(frozen_table)


def extract_code_from_gpt_response(code_raw, language):
    """search for matches and then look for pairs of ```...``` to extract code"""

    prefix_pos = [m.span()[0] for m in re.compile(f"```{language}").finditer(code_raw)]
    all_spans = [m.span() for m in re.compile("```").finditer(code_raw)]

    matches = []
    for i in range(len(all_spans) - 1):
        if all_spans[i][0] in prefix_pos and all_spans[i+1][0] not in prefix_pos:
            matches.append([all_spans[i][0], all_spans[i+1][1]])    
        
    results = []
    if len(matches) > 0:
        match = matches[0]

        for match in matches:
            code = code_raw[match[0]: match[1]]
            code = code[len(f"```{language}"): len(code) - len("```")]
            results.append(code)
        
    return results


def find_matching_bracket(text, start_index, bracket_type='curly'):  
    """Find the index of the matching closing bracket for JSON objects or arrays."""  
    if bracket_type == 'curly':  
        open_bracket, close_bracket = '{', '}'  
    elif bracket_type == 'square':  
        open_bracket, close_bracket = '[', ']'  
    else:  
        raise ValueError("Invalid bracket_type. Use 'curly' or 'square'.")  
  
    stack = []  
    for index in range(start_index, len(text)):  
        char = text[index]  
        if char == open_bracket:  
            stack.append(char)  
        elif char == close_bracket:  
            if not stack:  
                return -1  
            stack.pop()  
            if not stack:  
                return index  
    return -1  
  
def extract_json_objects(text):  
    """Extracts JSON objects and arrays from a text string.  
    Returns a list of parsed JSON objects and arrays.  
    """  
    json_objects = []  
    start_index = 0  
    while True:  
        # Search for the start of a JSON object or array  
        object_start = text.find('{', start_index)  
        array_start = text.find('[', start_index)  
          
        # Find the earliest JSON structure start  
        if object_start == -1 and array_start == -1:  
            break  
        elif object_start == -1:  
            start_index = array_start  
            bracket_type = 'square'  
        elif array_start == -1:  
            start_index = object_start  
            bracket_type = 'curly'  
        else:  
            start_index = min(object_start, array_start)  
            bracket_type = 'square' if start_index == array_start else 'curly'  
          
        # Find the matching closing bracket  
        end_index = find_matching_bracket(text, start_index, bracket_type)  
        if end_index == -1:  
            break  
          
        json_str = text[start_index:end_index + 1]  
        try:  
            json_obj = json.loads(json_str)  
            json_objects.append(json_obj)  
        except ValueError:  
            pass  
  
        start_index = end_index + 1  
  
    return json_objects  


def insert_candidates(code, table, dialog, candidate_groups):
    """ Try to insert a candidate into existing candidate groups
    Args:
        code: code candidate
        table: json records table
        candidate_groups: current candidate group
    Returns:
        a boolean flag incidate whether new_group_created
    """
    table_headers = sorted(table[0].keys())
    t_hash = table_hash([{c: r[c] for c in table_headers} for r in table])
    if t_hash in candidate_groups:
        candidate_groups[t_hash].append({"code": code, "content": table, "dialog": dialog})
        new_group_created = False
    else:
        candidate_groups[t_hash] = [{"code": code, "content": table, "dialog": dialog}]
        new_group_created = True
    return new_group_created

def dedup_data_transform_candidates(candidates):
    """each candidate is a tuple of {status: ..., code: ..., data: ..., dialog: ...},
    this function extracts candidates that are 'ok', and removes uncessary duplicates"""
    candidate_groups = {}
    for candidate in candidates:
        insert_candidates(candidate["code"], candidate['data'], candidate['dialog'], candidate_groups)
    return [items[0] for _, items in candidate_groups.items()]


def get_field_summary(field_name, df, field_sample_size, max_val_chars=100):
    # Convert lists to strings to make them hashable
    def make_hashable(val):
        if val is None:
            return None
        if isinstance(val, list):
            return str(val)
        return val
    
    try:
        values = sorted([make_hashable(x) for x in list(set([make_hashable(x) for x in df[field_name].values])) if x is not None])
    except:
        values = [make_hashable(x) for x in list(set([make_hashable(x) for x in df[field_name].values])) if x is not None]

    val_sample = ""

    sample_size = field_sample_size

    if len(values) <= sample_size:
        val_sample = values
    else:
        val_sample = values[:int(sample_size / 2)] + ["..."] + values[-(sample_size - int(sample_size / 2)):]

    def sample_val_cap(val):
        if len(str(val)) > max_val_chars:
            s = str(val)[:max_val_chars] + "..."
        else:
            s = str(val)

        if ',' in s:
            s = f'"{s}"'

        return s

    val_str = ', '.join([sample_val_cap(str(s)) for s in val_sample])

    return f"{field_name} -- type: {df[field_name].dtype}, values: {val_str}"

def generate_data_summary(input_tables, include_data_samples=True, field_sample_size=7, max_val_chars=140):
    
    def assemble_table_summary(input_table, idx):
        table_id = f'table{idx+1}'
        name = string_to_py_varname(input_table["name"])
        rows = input_table["rows"]
        description = input_table.get("attached_metadata", "")
        
        df = pd.DataFrame(rows)
        fields_summary = '\n'.join(['\t*' + get_field_summary(fname, df, field_sample_size, max_val_chars)  for fname in list(df.columns.values)])

        fields_section = f'## fields\n{fields_summary}\n\n'
        sample_section = f'## sample\n{pd.DataFrame(rows[:5]).to_string()}\n......\n\n' if include_data_samples else ''
        description_section = f'## description\n{description}\n\n' if description else ''

        summary_str = f'''# {table_id} ({name})\n\n{description_section}{fields_section}{sample_section}'''
        return summary_str

    table_summaries = [assemble_table_summary(input_table, i) for i, input_table in enumerate(input_tables)]
    
    # Join with newline (extracted from f-string for Python 3.9/3.10 compatibility)
    joined_summaries = '\n'.join(table_summaries)
    
    full_summary = f'''Here are our datasets, here are their summaries and samples:

{joined_summaries}
'''

    return full_summary

