# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import keyword
import logging
import time

import numpy as np
import re

_logger = logging.getLogger(__name__)

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
  
def _strip_json_comments(s: str) -> str:
    """Remove single-line ``//`` comments from a JSON-like string.

    Correctly skips ``//`` that appears inside quoted strings.
    """
    result: list[str] = []
    in_string = False
    escape_next = False
    i = 0
    while i < len(s):
        ch = s[i]
        if escape_next:
            result.append(ch)
            escape_next = False
            i += 1
            continue
        if ch == '\\' and in_string:
            escape_next = True
            result.append(ch)
            i += 1
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            i += 1
            continue
        if not in_string and s[i:i + 2] == '//':
            while i < len(s) and s[i] != '\n':
                i += 1
            continue
        result.append(ch)
        i += 1
    return ''.join(result)


def _fix_json_trailing_commas(s: str) -> str:
    """Remove trailing commas before ``}`` or ``]``."""
    return re.sub(r',\s*([}\]])', r'\1', s)


def _lenient_json_loads(json_str: str):
    """Try ``json.loads`` first; on failure, strip comments / trailing commas
    and retry.  Returns the parsed object or raises ``ValueError``.
    """
    try:
        return json.loads(json_str)
    except ValueError:
        cleaned = _fix_json_trailing_commas(_strip_json_comments(json_str))
        return json.loads(cleaned)


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
            json_obj = _lenient_json_loads(json_str)
            json_objects.append(json_obj)  
        except ValueError:  
            pass  
  
        start_index = end_index + 1  
  
    return json_objects  


def supplement_missing_block(client, messages, assistant_content,
                             parsed_json, code_blocks, prefix="[Agent]"):
    """When model produces only JSON or only code, request the missing block.

    Smaller models often fail to produce both JSON + code in a single
    response.  Rather than retrying the full prompt (which tends to
    reproduce the same partial output), we ask for *just* the missing
    piece in a focused single-task follow-up — much higher success rate.

    Returns (parsed_json, code_blocks, supplement_content, elapsed_seconds).
    supplement_content is None if no supplement was needed or it failed.
    """
    has_json = parsed_json is not None
    has_code = len(code_blocks) > 0

    if has_json == has_code:
        return parsed_json, code_blocks, None, 0.0

    if has_json:
        output_var = parsed_json.get('output_variable', 'result_df') or 'result_df'
        _logger.info(f"{prefix} JSON found but no Python code — requesting supplement")
        prompt = (
            "You produced the JSON spec but no Python code block. "
            "Now write ONLY the ```python``` code block. "
            f"The final DataFrame must be assigned to `{output_var}`."
        )
    else:
        _logger.info(f"{prefix} Python code found but no JSON spec — requesting supplement")
        prompt = (
            "You produced the Python code but no JSON spec. "
            "Now write ONLY the ```json``` spec block. "
            "Make sure to include `output_variable` matching the "
            "variable name used in your code."
        )

    try:
        t0 = time.time()
        supp_resp = client.get_completion(messages=[
            *messages,
            {"role": "assistant", "content": assistant_content},
            {"role": "user", "content": prompt},
        ])
        elapsed = time.time() - t0
        supp_text = supp_resp.choices[0].message.content

        if has_json:
            supp_codes = extract_code_from_gpt_response(supp_text + "\n", "python")
            if supp_codes:
                _logger.info(f"{prefix} Supplement succeeded — got Python code")
                return parsed_json, supp_codes, supp_text, elapsed
            _logger.warning(f"{prefix} Supplement did not produce Python code")
        else:
            for jb in extract_json_objects(supp_text + "\n"):
                if isinstance(jb, dict):
                    _logger.info(f"{prefix} Supplement succeeded — got JSON spec")
                    return jb, code_blocks, supp_text, elapsed
            _logger.warning(f"{prefix} Supplement did not produce JSON spec")
    except Exception as e:
        _logger.warning(f"{prefix} Supplement call failed: {e}")

    return parsed_json, code_blocks, None, 0.0


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

def generate_data_summary(
    input_tables,
    workspace,
    include_data_samples=True,
    field_sample_size=7,
    row_sample_size=5,
    max_val_chars=140,
    table_name_prefix="Table",
    primary_tables=None,
):
    """
    Generate a natural, well-organized summary of input tables by reading workspace parquet files.

    All tables (including temp tables) should be in the workspace before calling this function.
    Use WorkspaceWithTempData context manager to mount temp tables to workspace.

    When ``primary_tables`` is provided, the output is structured into tiered sections:
    - **[PRIMARY TABLE]** / **[PRIMARY TABLES]**: Full detail for the tables the user is focused on.
    - **[OTHER AVAILABLE TABLES]**: Full detail for the remaining tables.
    Sections are omitted when empty.

    Args:
        input_tables: list of dicts with 'name' key
        workspace: Workspace instance with all tables mounted (including temp data)
        include_data_samples: whether to include sample data
        field_sample_size: number of example values per field
        row_sample_size: number of sample rows to show
        max_val_chars: max characters per value
        table_name_prefix: prefix for table headers
        primary_tables: list of primary (focused) table names; enables tiered output

    Returns:
        Formatted string summary of all tables
    """
    def assemble_table_summary(table, idx):
        table_name = table['name']
        description = table.get("attached_metadata", "")

        # Read data into DataFrame (handles parquet, csv, excel, json, etc.)
        df = workspace.read_data_as_df(table_name)

        # Get filename for display (LLM uses this to generate read_parquet/read_csv calls)
        data_file_path = workspace.get_relative_data_file_path(table_name)

        num_rows = len(df)
        num_cols = len(df.columns)

        # Build sections in logical order: Overview → Description → Schema → Examples
        sections = []

        # 1. Table Header with basic stats
        header = f"## {table_name_prefix} {idx + 1}: {table_name}"
        if num_rows > 0:
            header += f" ({num_rows:,} rows × {num_cols} columns)"
        sections.append(header)
        sections.append(f"- **file path:** `{data_file_path}`")
        sections.append("")  # Empty line for spacing

        # 2. Description (if available) - provides context first
        if description:
            sections.append(f"### Description\n{description}\n")

        # 3. Schema/Fields - core structure information
        fields_summary = '\n'.join([
            '  - ' + get_field_summary(fname, df, field_sample_size, max_val_chars)
            for fname in df.columns
        ])
        sections.append(f"### Schema ({num_cols} fields)\n{fields_summary}\n")

        # 4. Sample data (if requested) - concrete examples last
        if include_data_samples and num_rows > 0:
            sample_df = df.head(row_sample_size)
            sections.append(
                f"### Sample Data (first {min(row_sample_size, num_rows)} rows)\n"
                f"```\n{sample_df.to_string()}\n```\n"
            )

        return '\n'.join(sections)

    # Build summaries for all tables
    table_summaries = [assemble_table_summary(table, i) for i, table in enumerate(input_tables)]

    separator = "\n" + "─" * 60 + "\n\n"

    # If primary_tables is specified, organize into tiered sections
    if primary_tables:
        primary_names = set(primary_tables)
        primary_parts = []
        other_parts = []
        for table, summary in zip(input_tables, table_summaries):
            if table['name'] in primary_names:
                primary_parts.append(summary)
            else:
                other_parts.append(summary)

        sections = []
        if primary_parts:
            header = "[PRIMARY TABLE]" if len(primary_parts) == 1 else "[PRIMARY TABLES]"
            sections.append(header + "\n\n" + separator.join(primary_parts))
        if other_parts:
            sections.append("[OTHER AVAILABLE TABLES]\n\n" + separator.join(other_parts))
        return "\n\n".join(sections)

    # Join with visual separators (no tiering)
    return separator.join(table_summaries)


def ensure_output_variable_in_code(code: str, output_variable: str) -> tuple[str, bool, str]:
    """Zero-cost regex patch: align code's actual output with the JSON-declared variable.

    This is a deterministic local fix (<1ms, 0 tokens) that runs *before*
    sandbox execution, avoiding an expensive LLM repair round-trip.
    It scans all top-level assignments (not just the last line, which may
    be ``print(...)``), picks the last non-library one, and appends an
    alias ``output_variable = <detected>``.

    Returns
    -------
    (patched_code, was_patched, detected_variable_name)
    """
    if not output_variable or not code:
        return code, False, ""

    # Check if output_variable appears as an assignment target (= but not ==, !=, <=, >=)
    pattern = rf'(?:^|\n)\s*{re.escape(output_variable)}\s*=(?!=)'
    if re.search(pattern, code):
        return code, False, ""

    # output_variable not assigned — find the likely actual output variable.
    all_assignments = re.findall(r'^([a-zA-Z_]\w*)\s*=(?!=)', code, re.MULTILINE)
    if not all_assignments:
        return code, False, ""

    LIBRARY_NAMES = frozenset({
        'pd', 'np', 'duckdb', 'conn', 'cursor', 'engine', 'warnings',
        'math', 'json', 're', 'datetime', 'os', 'sys', 'random', 'time',
        'itertools', 'functools', 'operator', 'collections', 'statistics',
    })

    candidates = [v for v in all_assignments
                  if v not in LIBRARY_NAMES and not v.startswith('_')]

    if candidates:
        best = candidates[-1]
    else:
        best = all_assignments[-1]

    patched_code = code.rstrip() + f"\n{output_variable} = {best}\n"
    return patched_code, True, best


