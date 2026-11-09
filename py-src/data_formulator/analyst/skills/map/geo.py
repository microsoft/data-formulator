# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Region-key lookups for map validation, mirroring the renderer's (src/maps/geography.ts).

``countries.json`` is a copy of ``src/maps/data/countries.json`` (a test keeps them equal).
Region ids: ISO 3166-1 alpha-3 for countries, two-digit FIPS for US states, five-digit
FIPS for counties.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

_PUNCTUATION = re.compile(r"[.'’`,()]")
_SEPARATORS = re.compile(r"[-_/]+")
_SPACES = re.compile(r"\s+")
_DIGITS = re.compile(r"^\s*\d+\s*$")

US_STATES: list[tuple[str, str, str]] = [
    ("AL", "01", "Alabama"), ("AK", "02", "Alaska"), ("AZ", "04", "Arizona"), ("AR", "05", "Arkansas"), ("CA", "06", "California"),
    ("CO", "08", "Colorado"), ("CT", "09", "Connecticut"), ("DE", "10", "Delaware"), ("DC", "11", "District of Columbia"),
    ("FL", "12", "Florida"), ("GA", "13", "Georgia"), ("HI", "15", "Hawaii"), ("ID", "16", "Idaho"), ("IL", "17", "Illinois"),
    ("IN", "18", "Indiana"), ("IA", "19", "Iowa"), ("KS", "20", "Kansas"), ("KY", "21", "Kentucky"), ("LA", "22", "Louisiana"),
    ("ME", "23", "Maine"), ("MD", "24", "Maryland"), ("MA", "25", "Massachusetts"), ("MI", "26", "Michigan"), ("MN", "27", "Minnesota"),
    ("MS", "28", "Mississippi"), ("MO", "29", "Missouri"), ("MT", "30", "Montana"), ("NE", "31", "Nebraska"), ("NV", "32", "Nevada"),
    ("NH", "33", "New Hampshire"), ("NJ", "34", "New Jersey"), ("NM", "35", "New Mexico"), ("NY", "36", "New York"),
    ("NC", "37", "North Carolina"), ("ND", "38", "North Dakota"), ("OH", "39", "Ohio"), ("OK", "40", "Oklahoma"), ("OR", "41", "Oregon"),
    ("PA", "42", "Pennsylvania"), ("RI", "44", "Rhode Island"), ("SC", "45", "South Carolina"), ("SD", "46", "South Dakota"),
    ("TN", "47", "Tennessee"), ("TX", "48", "Texas"), ("UT", "49", "Utah"), ("VT", "50", "Vermont"), ("VA", "51", "Virginia"),
    ("WA", "53", "Washington"), ("WV", "54", "West Virginia"), ("WI", "55", "Wisconsin"), ("WY", "56", "Wyoming"),
    ("AS", "60", "American Samoa"), ("GU", "66", "Guam"), ("MP", "69", "Northern Mariana Islands"), ("PR", "72", "Puerto Rico"),
    ("VI", "78", "U.S. Virgin Islands"),
]


def normalize_name(value: str) -> str:
    """Lower-case, strip accents and punctuation, drop a leading "the" (as the renderer does)."""
    text = "".join(character for character in unicodedata.normalize("NFKD", value) if not unicodedata.combining(character))
    text = text.lower().replace("&", " and ")
    text = _SEPARATORS.sub(" ", _PUNCTUATION.sub("", text))
    text = _SPACES.sub(" ", text).strip()
    return text[4:] if text.startswith("the ") else text


def _integer_text(value: Any) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, str) and _DIGITS.match(value):
        return value.strip()
    return None


@lru_cache(maxsize=1)
def _countries() -> dict[str, dict[str, Any]]:
    rows = json.loads((Path(__file__).parent / "countries.json").read_text(encoding="utf-8"))
    numeric = {row["n"]: row["a3"] for row in rows if row["n"]}
    alpha2 = {row["a2"]: row["a3"] for row in rows}
    alpha3 = {row["a3"]: row["a3"] for row in rows}
    names: dict[str, str] = {}
    for row in rows:
        for alias in [row["name"], *row["aliases"]]:
            names.setdefault(normalize_name(alias), row["a3"])
    return {"numeric": numeric, "a2": alpha2, "a3": alpha3, "names": names}


def country_id(value: Any, key_type: str = "auto") -> str | None:
    if value is None or value == "":
        return None
    table = _countries()
    digits = _integer_text(value)
    if key_type == "iso-numeric" or (key_type == "auto" and digits is not None):
        return table["numeric"].get(digits.zfill(3)) if digits is not None else None
    text = str(value).strip()
    upper = text.upper()
    if key_type == "iso2" or (key_type == "auto" and re.fullmatch(r"[A-Za-z]{2}", text)):
        found = table["a2"].get("GB" if upper == "UK" else upper)
        if found or key_type == "iso2":
            return found
    if key_type == "iso3" or (key_type == "auto" and re.fullmatch(r"[A-Za-z]{3}", text)):
        found = table["a3"].get(upper)
        if found or key_type == "iso3":
            return found
    return table["names"].get(normalize_name(text))


_STATE_BY_ABBR = {abbr: fips for abbr, fips, _ in US_STATES}
_STATE_BY_NAME = {normalize_name(name): fips for _, fips, name in US_STATES}
_STATE_BY_NAME.update({normalize_name("Washington DC"): "11", normalize_name("Washington D.C."): "11",
                       normalize_name("Commonwealth of the Northern Mariana Islands"): "69",
                       normalize_name("United States Virgin Islands"): "78"})
_STATE_FIPS = set(_STATE_BY_ABBR.values())


def state_id(value: Any) -> str | None:
    if value is None or value == "":
        return None
    digits = _integer_text(value)
    if digits is not None:
        fips = digits.zfill(2) if len(digits) <= 2 else None
        return fips if fips in _STATE_FIPS else None
    text = str(value).strip()
    return _STATE_BY_ABBR.get(text.upper()) or _STATE_BY_NAME.get(normalize_name(text))


def county_id(value: Any) -> str | None:
    digits = _integer_text(value)
    if digits is None or len(digits) > 5:
        return None
    fips = digits.zfill(5)
    return fips if fips[:2] in _STATE_FIPS else None


def normalize_key(value: Any) -> str:
    """Custom-file keys compare as trimmed, case-folded text; integers lose leading zeros."""
    digits = _integer_text(value)
    if digits is not None:
        return str(int(digits))
    return normalize_name("" if value is None else str(value))


def region_id(value: Any, geo_set: str, key_type: str = "auto") -> str | None:
    """Resolve a key against a built-in set ("countries", "us-states", "us-counties")."""
    if geo_set.startswith("countries"):
        return country_id(value, key_type)
    if geo_set == "us-states":
        return state_id(value)
    if geo_set == "us-counties":
        return state_id(value) if key_type == "us-state" else county_id(value)
    return normalize_key(value)


def layer_geo_set(geo: str | None, key_type: str | None, basemap: str) -> str:
    """The set a layer joins: its ``geo``, else implied by its key type or the basemap."""
    if geo == "countries" and basemap == "world-detailed":
        return "countries-detailed"
    if geo:
        return geo
    if key_type == "us-state":
        return "us-states"
    if key_type == "fips":
        return "us-counties"
    if key_type in ("iso2", "iso3", "iso-numeric", "country-name"):
        return "countries-detailed" if basemap == "world-detailed" else "countries"
    if basemap in ("us-states", "us-counties"):
        return basemap
    return "countries-detailed" if basemap == "world-detailed" else "countries"
