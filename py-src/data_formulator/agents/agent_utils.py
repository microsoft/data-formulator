# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import keyword
import logging
import time
from pathlib import Path
from typing import Any

import numpy as np
import re

_logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# reasoning_content helpers
# ---------------------------------------------------------------------------

def attach_reasoning_content(msg: dict, choice_message) -> dict:
    """Attach ``reasoning_content`` from an LLM response to an assistant message dict.

    Some reasoning models (currently DeepSeek V4) return a
    ``reasoning_content`` field alongside the regular ``content``.
    In multi-turn conversations this field **must** be echoed back in the
    assistant message, otherwise the API may reject the request or the
    chain-of-thought context is lost.

    For models that do not produce this field the function is a safe no-op.

    Args:
        msg: The assistant message dict (mutated in-place and returned).
        choice_message: The ``choice.message`` object from an LLM response.

    Returns:
        The same *msg* dict, for chaining convenience.

    See: https://api-docs.deepseek.com/guides/reasoning_model
    """
    rc = getattr(choice_message, "reasoning_content", None)
    if rc is not None:
        msg["reasoning_content"] = rc
    return msg


def accumulate_reasoning_content(
    accumulated: str | None, delta
) -> str | None:
    """Accumulate ``reasoning_content`` from streaming delta chunks.

    In streaming mode, reasoning models (currently DeepSeek V4) deliver
    ``reasoning_content`` as incremental ``delta.reasoning_content``
    chunks, similar to ``delta.content``.  This helper concatenates them.

    For non-reasoning models the delta has no such attribute; the
    accumulator is returned unchanged.

    Args:
        accumulated: The string accumulated so far, or ``None``.
        delta: A streaming ``choice.delta`` object.

    Returns:
        Updated accumulator (``str`` once the first chunk arrives,
        ``None`` if no reasoning_content has been seen).
    """
    rc_delta = getattr(delta, "reasoning_content", None)
    if rc_delta:
        return (accumulated or "") + rc_delta
    return accumulated


def _source_table_matches_catalog_entry(
    source_table: str,
    catalog_entry: dict[str, Any],
) -> bool:
    meta = catalog_entry.get("metadata") or {}
    candidates = {
        str(catalog_entry.get("table_key") or ""),
        str(catalog_entry.get("name") or ""),
        str(meta.get("_source_name") or ""),
        str(meta.get("dataset_id") or ""),
        str(meta.get("uuid") or ""),
    }
    return bool(source_table and source_table in candidates)


def build_catalog_metadata_lookups(
    workspace,
) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, list[str]], dict[str, dict[str, dict]]]:
    """Build table/column metadata overlays from catalog cache (loader-only).

    Returns
    -------
    4-tuple of (table_desc_cache, col_desc_cache, table_extra_cache, col_meta_cache)
    where col_meta_cache maps table_name -> {col_name: {"verbose_name": ..., "expression": ...}}.
    """
    table_desc_cache: dict[str, str] = {}
    col_desc_cache: dict[str, dict[str, str]] = {}
    table_extra_cache: dict[str, list[str]] = {}
    col_meta_cache: dict[str, dict[str, dict]] = {}

    user_home = getattr(workspace, "user_home", None)
    if not user_home:
        return table_desc_cache, col_desc_cache, table_extra_cache, col_meta_cache

    try:
        ws_meta = workspace.get_metadata()
        if not ws_meta:
            return table_desc_cache, col_desc_cache, table_extra_cache, col_meta_cache

        from data_formulator.datalake.catalog_cache import list_cached_sources, load_catalog

        # Source-only catalog: no user annotation merge. The agent now only
        # sees descriptions that came from the source system (SQL comments,
        # Glue parameters, BigQuery field descriptions, …). User-authored
        # guidance lives in Knowledge → Rules instead.
        catalogs: list[dict[str, Any]] = []
        for source_id in list_cached_sources(user_home):
            catalog = load_catalog(Path(user_home), source_id) or []
            catalogs.extend(catalog)

        for table_name, table_meta in ws_meta.tables.items():
            source_table = getattr(table_meta, "source_table", None)
            if not source_table:
                continue
            match = next(
                (
                    entry for entry in catalogs
                    if _source_table_matches_catalog_entry(str(source_table), entry)
                ),
                None,
            )
            if not match:
                continue

            meta = match.get("metadata") or {}
            table_desc = meta.get("source_description") or meta.get("description")
            if table_desc:
                table_desc_cache[table_name] = str(table_desc)

            column_descs: dict[str, str] = {}
            col_metas: dict[str, dict] = {}
            for col in meta.get("columns", []):
                if not isinstance(col, dict) or not col.get("name"):
                    continue
                col_name = str(col["name"])
                col_desc = col.get("source_description") or col.get("description")
                if col_desc:
                    column_descs[col_name] = str(col_desc)
                cm: dict[str, str] = {}
                vn = col.get("verbose_name")
                if vn:
                    cm["verbose_name"] = vn
                expr = col.get("expression")
                if expr:
                    cm["expression"] = expr
                if col_desc:
                    cm["source_description"] = str(col_desc)
                if cm:
                    col_metas[col_name] = cm
            if column_descs:
                col_desc_cache[table_name] = column_descs
            if col_metas:
                col_meta_cache[table_name] = col_metas
    except Exception:
        _logger.debug("Failed to build catalog metadata lookups", exc_info=True)

    return table_desc_cache, col_desc_cache, table_extra_cache, col_meta_cache

def format_dataframe_sample_with_budget(
    df,
    max_rows: int = 5,
    max_chars: int = 1000,
    *,
    index: bool = False,
    max_colwidth: int | None = None,
) -> tuple[str, int, bool]:
    """Return the largest head() sample that fits within a character budget."""
    if df is None or len(df) == 0 or max_rows <= 0 or max_chars <= 0:
        return "", 0, False

    row_count = min(max_rows, len(df))
    to_string_kwargs = {"index": index}
    if max_colwidth is not None:
        to_string_kwargs["max_colwidth"] = max_colwidth

    for rows in range(row_count, 0, -1):
        sample = df.head(rows).to_string(**to_string_kwargs)
        if len(sample) <= max_chars:
            return sample, rows, rows < row_count

    sample = df.head(1).to_string(**to_string_kwargs)
    suffix = "\n... (truncated)"
    if max_chars <= len(suffix):
        return sample[:max_chars], 1, True
    return sample[:max_chars - len(suffix)] + suffix, 1, True

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

    dtype = str(df[name].dtype)
    if dtype == "object":
        return "string"
    elif "int" in dtype or "float" in dtype:
        return "number"
    elif "bool" in dtype:
        return "boolean"
    elif "datetime" in dtype:
        return "DateTime"
    elif "timedelta" in dtype:
        return "Duration"
    else:
        return "any"

def value_handling_func(val):
    """process values to make it comparable"""
    if isinstance(val, (int,)):
        return val
    try:
        val = float(val)
        val = np.round(val, 5)
    except (ValueError, TypeError):
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


def get_field_summary(field_name, df, field_sample_size, max_val_chars=100,
                      column_description=None, verbose_name=None, expression=None):
    def make_hashable(val):
        if val is None:
            return None
        if isinstance(val, list):
            return str(val)
        return val
    
    try:
        values = sorted([make_hashable(x) for x in list(set([make_hashable(x) for x in df[field_name].values])) if x is not None])
    except Exception:
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

    line = f"{field_name}"
    if verbose_name:
        line += f" [{verbose_name}]"
    line += f" -- type: {df[field_name].dtype}, values: {val_str}"
    if column_description:
        line += f"  ({column_description})"
    if expression:
        line += f"  [calc: {expression}]"
    return line


def _format_import_options(opts: dict | None) -> str:
    """Format import_options into a concise human-readable provenance line."""
    if not opts:
        return ""
    parts: list[str] = []
    sf = opts.get("source_filters")
    if sf and isinstance(sf, list) and len(sf) > 0:
        parts.append(f"{len(sf)} filter(s)")
    sc = opts.get("sort_columns")
    so = opts.get("sort_order", "asc")
    if sc and isinstance(sc, list) and len(sc) > 0:
        parts.append(f"sorted by {', '.join(sc)} {so}")
    size = opts.get("size")
    if size is not None:
        parts.append(f"row limit {size:,}")
    if not parts:
        return ""
    return "Data subset: " + ", ".join(parts)


def generate_data_summary(
    input_tables,
    workspace,
    include_data_samples=True,
    field_sample_size=7,
    row_sample_size=5,
    sample_char_limit=None,
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
        sample_char_limit: optional max characters for each table's sample rows
        max_val_chars: max characters per value
        table_name_prefix: prefix for table headers
        primary_tables: list of primary (focused) table names; enables tiered output

    Returns:
        Formatted string summary of all tables
    """
    # Build column description lookup from workspace metadata
    col_desc_cache: dict[str, dict[str, str]] = {}
    table_desc_cache: dict[str, str] = {}
    table_extra_cache: dict[str, list[str]] = {}
    import_opts_cache: dict[str, str] = {}
    try:
        ws_meta = workspace.get_metadata()
        if ws_meta:
            for tname, tmeta in ws_meta.tables.items():
                if tmeta.description:
                    table_desc_cache[tname] = tmeta.description
                if tmeta.columns:
                    cd = {}
                    for col in tmeta.columns:
                        if col.description:
                            cd[col.name] = col.description
                    if cd:
                        col_desc_cache[tname] = cd
                opts_line = _format_import_options(tmeta.import_options)
                if opts_line:
                    import_opts_cache[tname] = opts_line
    except Exception:
        pass

    catalog_table_descs, catalog_col_descs, catalog_extras, catalog_col_metas = build_catalog_metadata_lookups(
        workspace,
    )
    col_meta_cache: dict[str, dict[str, dict]] = {}
    table_desc_cache.update(catalog_table_descs)
    for tname, col_descs in catalog_col_descs.items():
        col_desc_cache.setdefault(tname, {}).update(col_descs)
    table_extra_cache.update(catalog_extras)
    col_meta_cache.update(catalog_col_metas)

    def assemble_table_summary(table, idx):
        table_name = table['name']
        description = table_desc_cache.get(table_name, "")

        try:
            df = workspace.read_data_as_df(table_name)
        except (FileNotFoundError, KeyError) as exc:
            _logger.info("Table %s not in workspace, trying inline rows", table_name)
            inline_rows = table.get("rows")
            if inline_rows and len(inline_rows) > 0:
                import pandas as pd
                df = pd.DataFrame(inline_rows)
            else:
                _logger.warning("Could not read table %s for summary: %s", table_name, exc)
                from data_formulator.error_handler import collect_stream_warning
                collect_stream_warning(
                    f"Table '{table_name}' data unavailable — it may have been removed or renamed",
                    message_code="TABLE_READ_FAILED",
                )
                return f"## {table_name_prefix} {idx + 1}: {table_name}\n- ⚠ Table data unavailable (may have been removed or renamed)"

        try:
            data_file_path = workspace.get_relative_data_file_path(table_name)
        except (FileNotFoundError, KeyError):
            data_file_path = "(in-memory)"

        num_rows = len(df)
        num_cols = len(df.columns)

        sections = []

        header = f"## {table_name_prefix} {idx + 1}: {table_name}"
        if num_rows > 0:
            header += f" ({num_rows:,} rows × {num_cols} columns)"
        sections.append(header)
        sections.append(f"- **file path:** `{data_file_path}`")
        sections.append("")

        if description:
            sections.append(f"### Description\n{description}\n")
        load_provenance = import_opts_cache.get(table_name, "")
        if load_provenance:
            sections.append(f"- **{load_provenance}**\n")
        extra_lines = table_extra_cache.get(table_name, [])
        if extra_lines:
            sections.append("### Catalog Metadata\n" + "\n".join(f"- {line}" for line in extra_lines) + "\n")

        col_descs = col_desc_cache.get(table_name, {})
        col_metas = col_meta_cache.get(table_name, {})
        fields_summary = '\n'.join([
            '  - ' + get_field_summary(
                fname, df, field_sample_size, max_val_chars,
                column_description=col_descs.get(fname),
                verbose_name=col_metas.get(fname, {}).get("verbose_name"),
                expression=col_metas.get(fname, {}).get("expression"),
            )
            for fname in df.columns
        ])
        sections.append(f"### Schema ({num_cols} fields)\n{fields_summary}\n")

        if include_data_samples and num_rows > 0:
            if sample_char_limit is None:
                sample_df = df.head(row_sample_size)
                sample = sample_df.to_string()
                displayed_rows = min(row_sample_size, num_rows)
                suffix = ""
            else:
                sample, displayed_rows, sample_truncated = format_dataframe_sample_with_budget(
                    df,
                    max_rows=row_sample_size,
                    max_chars=sample_char_limit,
                    index=True,
                )
                suffix = " (truncated to fit context budget)" if sample_truncated else ""
            sections.append(
                f"### Sample Data (first {displayed_rows} rows{suffix})\n"
                f"```\n{sample}\n```\n"
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


