from typing import Any, Dict, List, Optional, Union
import json
from datetime import datetime
import re
from pyparsing import (
    Word, alphas, alphanums, Literal, Suppress, 
    ZeroOrMore, Combine, ParseException
)


class MongoQueryParser:
    # MongoDB Shell query parser
    
    def __init__(self):
        self._build_grammar()
    
    def _build_grammar(self):
        # Build parsing grammar
        self.db_keyword = Literal("db")
        
        # Define identifier (collection name, method name, etc.)
        identifier = Word(alphas + "_", alphanums + "_")
        
        # Define dot separator
        dot = Literal(".")
        
        # Define statement starting with db
        self.db_statement = Combine(
            self.db_keyword + 
            ZeroOrMore(dot + identifier)
        )
        
        self.supported_methods = [
            "find", "findOne", "limit", "sort", "aggregate", 
            "countDocuments", "skip", "distinct", "estimatedDocumentCount"
        ]
    
    def is_db_query(self, query_string: str) -> bool:
        # Check if string starts with db
        query_string = query_string.strip()
        try:
            self.db_keyword.parseString(query_string)
            return True
        except ParseException:
            return False
    
    def _extract_balanced_content(self, text: str, start_char: str, end_char: str) -> str:
        # Extract content within balanced brackets
        depth = 0
        start_idx = -1
        in_string = False
        string_char = None
        
        for i, char in enumerate(text):
            if char in ('"', "'") and (i == 0 or text[i-1] != '\\'):
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    in_string = False
                continue
            
            if in_string:
                continue
                
            if char == start_char:
                if depth == 0:
                    start_idx = i
                depth += 1
            elif char == end_char:
                depth -= 1
                if depth == 0 and start_idx != -1:
                    return text[start_idx + 1:i]
        
        return ""
    
    def _split_method_args(self, content: str) -> List[str]:
        # Split method arguments, correctly handling nested {} and []
        # For example: { filter }, { projection } -> ['{filter}', '{projection}']
        args = []
        depth = 0
        current_arg = []
        in_string = False
        string_char = None
        
        for i, char in enumerate(content):
            if char in ('"', "'") and (i == 0 or content[i-1] != '\\'):
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    in_string = False
                current_arg.append(char)
                continue
            
            if in_string:
                current_arg.append(char)
                continue
            
            if char in ('{', '[', '('):
                depth += 1
                current_arg.append(char)
            elif char in ('}', ']', ')'):
                depth -= 1
                current_arg.append(char)
            elif char == ',' and depth == 0:
                arg_str = ''.join(current_arg).strip()
                if arg_str:
                    args.append(arg_str)
                current_arg = []
            else:
                current_arg.append(char)
        
        arg_str = ''.join(current_arg).strip()
        if arg_str:
            args.append(arg_str)
        
        return args
    
    def _mongo_to_json_string(self, mongo_str: str) -> str:
        # Convert MongoDB Shell syntax to standard JSON string
        if not mongo_str or not mongo_str.strip():
            return ""
        
        result = mongo_str.strip()
        
        double_quoted = []
        def save_double_quoted(match):
            double_quoted.append(match.group(0))
            return f"__DOUBLE_QUOTED_{len(double_quoted) - 1}__"
        
        result = re.sub(r'"(?:[^"\\]|\\.)*"', save_double_quoted, result)
        
        result = re.sub(r"'((?:[^'\\]|\\.)*)'", r'"\1"', result)
        
        for i, s in enumerate(double_quoted):
            result = result.replace(f"__DOUBLE_QUOTED_{i}__", s)
        
        result = re.sub(
            r'([{,\[]\s*)(\$?[a-zA-Z_][a-zA-Z0-9_.]*)(\s*:)',
            r'\1"\2"\3',
            result
        )

        result = re.sub(r',(\s*[}\]])', r'\1', result)
        
        result = re.sub(r'NumberLong\s*\(\s*["\']?(-?\d+)["\']?\s*\)', r'\1', result)
        result = re.sub(r'NumberInt\s*\(\s*["\']?(-?\d+)["\']?\s*\)', r'\1', result)
        result = re.sub(r'NumberDecimal\s*\(\s*["\']?([^"\']+)["\']?\s*\)', r'\1', result)
        result = re.sub(r'ObjectId\s*\(\s*["\']([^"\']+)["\']\s*\)', r'{"$oid": "\1"}', result)
        result = re.sub(r'ISODate\s*\(\s*["\']([^"\']+)["\']\s*\)', r'{"$date": "\1"}', result)
        result = re.sub(r'new\s+Date\s*\(\s*["\']([^"\']+)["\']\s*\)', r'{"$date": "\1"}', result)
        result = re.sub(r'Timestamp\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)', r'{"$timestamp": {"t": \1, "i": \2}}', result)
        
        return result
    
    def _convert_extended_json(self, obj):
        # Convert MongoDB Extended JSON types to Python types
        if isinstance(obj, dict):
            if "$date" in obj and len(obj) == 1:
                date_str = obj["$date"]
                try:
                    return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                except ValueError:
                    return date_str

            return {k:self._convert_extended_json(v) for k, v in obj.items()}
        
        elif isinstance(obj, list):
            return [self._convert_extended_json(item) for item in obj]
        
        return obj
    
    def _parse_to_json(self, mongo_str: str) -> Union[Dict, List, int, float, str, None]:
        # Convert MongoDB Shell syntax to Python object
        if not mongo_str or not mongo_str.strip():
            return None
        
        stripped = mongo_str.strip()
        
        if re.match(r'^-?\d+$', stripped):
            return int(stripped)
        if re.match(r'^-?\d+\.\d+$', stripped):
            return float(stripped)
        
        if (stripped.startswith('"') and stripped.endswith('"')) or \
           (stripped.startswith("'") and stripped.endswith("'")):
            return stripped[1:-1]
        
        json_str = self._mongo_to_json_string(mongo_str)
        
        if not json_str:
            return None
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            return {
                "_parse_error": str(e),
                "_raw": mongo_str.strip(),
                "_converted": json_str
            }
    
    def _extract_method_params_raw(self, query_string: str, method: str) -> List[str]:
        # Extract raw parameter strings for a given method
        pattern = rf'\.{method}\s*\('
        match = re.search(pattern, query_string)
        
        if not match:
            return []
        
        start_pos = match.end() - 1
        remaining = query_string[start_pos:]
        content = self._extract_balanced_content(remaining, '(', ')')
        
        if not content.strip():
            return []
        
        return self._split_method_args(content)
    
    def _extract_method_params(self, query_string: str) -> Dict[str, Any]:
        # Extract parameters for all supported methods
        method_params = {}
        
        for method in self.supported_methods:
            raw_args = self._extract_method_params_raw(query_string, method)
            
            if not raw_args:
                continue
            
            parsed_args = [self._parse_to_json(arg) for arg in raw_args]
            
            if len(parsed_args) == 1:
                method_params[method] = parsed_args[0]
            else:
                method_params[method] = parsed_args
        
        return method_params
    
    def _split_by_dot(self, query_string: str) -> List[str]:
        # Split query string by dots outside of parentheses
        query_string = query_string.strip()
        
        if not self.is_db_query(query_string):
            raise ValueError("Query must start with 'db'")
        
        identifier = Word(alphas + "_", alphanums + "_")
        dot = Suppress(Literal("."))
        
        parts_grammar = (
            Literal("db") + 
            ZeroOrMore(dot + identifier)
        )
        
        try:
            query_without_params = query_string.split("(")[0]
            result = parts_grammar.parseString(query_without_params)
            return list(result)
        except ParseException as e:
            raise ValueError(f"Parsing failed: {e}")
    
    def parse(self, query_string: str) -> Dict[str, Any]:
        # Parse the MongoDB Shell query string
        query_string = query_string.strip().rstrip(';')
        
        if not self.is_db_query(query_string):
            raise ValueError("Query must start with 'db.'")
        
        parts = self._split_by_dot(query_string)
        method_params = self._extract_method_params(query_string)
        
        if len(parts) < 2:
            raise ValueError("Invalid query format, missing collection name")
        
        collection = parts[1]
        method = parts[2] if len(parts) >= 3 else None
        
        # Construct the result dictionary
        result = {
            "collection": collection,
            "method": method,
            "filter": {},
            "projection": None,
            "pipeline": None,
            "options": {}
        }
        
        # Parse find / findOne
        if method in ("find", "findOne"):
            find_params = method_params.get(method)
            if find_params is not None:
                if isinstance(find_params, list):
                    # find(filter, projection) two-parameter case
                    if len(find_params) >= 1 and find_params[0]:
                        if isinstance(find_params[0], dict) and "_parse_error" in find_params[0]:
                            raise ValueError(f"Parsing {method} filter Parameter Failed: {find_params[0]['_parse_error']}")
                        result["filter"] = find_params[0]
                    if len(find_params) >= 2 and find_params[1]:
                        if isinstance(find_params[1], dict) and "_parse_error" in find_params[1]:
                            raise ValueError(f"Parsing {method} projection Parameter Failed: {find_params[1]['_parse_error']}")
                        result["projection"] = find_params[1]
                elif isinstance(find_params, dict):
                    # Single-parameter case
                    if "_parse_error" in find_params:
                        raise ValueError(f"Parsing {method} Parameter Failed: {find_params['_parse_error']}")
                    result["filter"] = find_params
        
        # Parse aggregate
        elif method == "aggregate":
            pipeline = method_params.get("aggregate")
            if pipeline is not None:
                if isinstance(pipeline, dict) and "_parse_error" in pipeline:
                    raise ValueError(f"Parsing aggregate pipeline Failed: {pipeline['_parse_error']}")
                result["pipeline"] = pipeline if isinstance(pipeline, list) else []
        
        # Parse countDocuments
        elif method == "countDocuments":
            filter_param = method_params.get("countDocuments")
            if filter_param and isinstance(filter_param, dict):
                if "_parse_error" not in filter_param:
                    result["filter"] = filter_param
        
        # Parse distinct
        elif method == "distinct":
            distinct_param = method_params.get("distinct")
            if distinct_param:
                if isinstance(distinct_param, str):
                    # distinct("fieldName") single parameter
                    result["field"] = distinct_param
                elif isinstance(distinct_param, list):
                    # distinct("fieldName", filter) two-parameter case
                    if len(distinct_param) >= 1:
                        result["field"] = distinct_param[0]
                    if len(distinct_param) >= 2 and isinstance(distinct_param[1], dict):
                        result["filter"] = distinct_param[1]
        
        # Parse chained call options: sort, limit, skip
        if "sort" in method_params:
            sort_param = method_params["sort"]
            if isinstance(sort_param, dict) and "_parse_error" not in sort_param:
                result["options"]["sort"] = sort_param
        
        if "limit" in method_params:
            limit_param = method_params["limit"]
            if isinstance(limit_param, int):
                result["options"]["limit"] = limit_param
        
        if "skip" in method_params:
            skip_param = method_params["skip"]
            if isinstance(skip_param, int):
                result["options"]["skip"] = skip_param
        
        if result["filter"]:
            result["filter"] = self._convert_extended_json(result["filter"])
        if result["projection"]:
            result["projection"] = self._convert_extended_json(result["projection"])
        if result["pipeline"]:
            result["pipeline"] = self._convert_extended_json(result["pipeline"])

        return result


_parser_instance = None

def get_parser() -> MongoQueryParser:
    # Singleton access to MongoQueryParser instance
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = MongoQueryParser()
    return _parser_instance
