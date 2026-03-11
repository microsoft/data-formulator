#!/usr/bin/env python3
"""
Bản one-shot của sync-code.py
Chạy một lần: fetch dữ liệu, push ClickHouse, rồi thoát
Thích hợp cho cron job hay scheduled task
"""

import oracledb
import clickhouse_connect
import time
import logging
import os
import sys
from decimal import Decimal
from datetime import datetime, date

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

# ================= CONFIG =================

ORACLE_CONNECTION_STRING = os.environ.get(
    "ORACLE_CONNECTION_STRING",
    (
        "User Id=weboutput;Password=weboutputpwd;"
        "Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)"
        "(HOST=172.25.9.40)(PORT=1521)))"
        "(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));"
    )
)

CLICKHOUSE_HOST = os.environ.get("CH_HOST", "172.19.16.23")
CLICKHOUSE_PORT = int(os.environ.get("CH_PORT", "8123"))
CLICKHOUSE_DB = os.environ.get("CH_DB", "QC_DATA")
CLICKHOUSE_USER = os.environ.get("CH_USER", "admin")
CLICKHOUSE_PASS = os.environ.get("CH_PASSWORD", "1fEQlaBivOpYXzw#")

CLICKHOUSE_TABLE = "DPD_QC_INFO"
BATCH_SIZE = 1000
MAX_RETRIES = 3

# ================= CONNECTION =================

ora_conn = None
ch_client = None

def parse_oracle_connection_string(conn_str):
    import re
    params = {}
    match = re.search(r'User\s+Id\s*=\s*([^;]+)', conn_str, re.IGNORECASE)
    if match:
        params['user'] = match.group(1).strip()
    match = re.search(r'Password\s*=\s*([^;]+)', conn_str, re.IGNORECASE)
    if match:
        params['password'] = match.group(1).strip()
    match = re.search(r'\(HOST\s*=\s*([^)]+)\)', conn_str, re.IGNORECASE)
    if match:
        params['host'] = match.group(1).strip()
    match = re.search(r'\(PORT\s*=\s*(\d+)\)', conn_str, re.IGNORECASE)
    if match:
        params['port'] = int(match.group(1))
    match = re.search(r'\(SERVICE_NAME\s*=\s*([^)]+)\)', conn_str, re.IGNORECASE)
    if match:
        params['service_name'] = match.group(1).strip()
    return params

def connect_oracle():
    global ora_conn
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            params = parse_oracle_connection_string(ORACLE_CONNECTION_STRING)
            ora_conn = oracledb.connect(**params)
            ora_conn.autocommit = False
            log.info("Oracle connected.")
            return True
        except Exception as e:
            log.warning(f"Oracle connect attempt {attempt}/{MAX_RETRIES} failed: {e}")
            time.sleep(3 * attempt)
    return False

def connect_clickhouse():
    global ch_client
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            ch_client = clickhouse_connect.get_client(
                host=CLICKHOUSE_HOST,
                port=CLICKHOUSE_PORT,
                username=CLICKHOUSE_USER,
                password=CLICKHOUSE_PASS,
                database=CLICKHOUSE_DB
            )
            log.info("ClickHouse connected.")
            return True
        except Exception as e:
            log.warning(f"ClickHouse connect attempt {attempt}/{MAX_RETRIES} failed: {e}")
            time.sleep(3 * attempt)
    return False

# ================= TYPE HELPERS =================

def safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None

def safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def safe_str(val):
    if val is None:
        return None
    return str(val)

def safe_str_upper(val):
    if val is None:
        return None
    return str(val).upper()

def safe_datetime_str(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(val, date):
        return val.strftime("%Y-%m-%d")
    return str(val)

def extract_month(qcdate_val):
    if qcdate_val is None:
        return None
    try:
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        return dt.month
    except (ValueError, TypeError):
        return None

def extract_iso_week(qcdate_val):
    if qcdate_val is None:
        return None
    try:
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        return dt.isocalendar()[1]
    except (ValueError, TypeError):
        return None

def extract_iso_year(qcdate_val):
    if qcdate_val is None:
        return None
    try:
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        return dt.isocalendar()[0]
    except (ValueError, TypeError):
        return None

# ================= CHECKPOINT =================

def get_last_seq():
    cur = ora_conn.cursor()
    try:
        cur.execute("SELECT last_seq FROM hoyav3.sync_checkpoint WHERE name = 'QC_LOG'")
        row = cur.fetchone()
        if row and row[0] is not None:
            return safe_int(row[0])
        return 0
    finally:
        cur.close()

def update_last_seq(seq):
    cur = ora_conn.cursor()
    try:
        cur.execute("UPDATE hoyav3.sync_checkpoint SET last_seq = :1 WHERE name = 'QC_LOG'", [int(seq)])
        if cur.rowcount == 0:
            cur.execute("INSERT INTO hoyav3.sync_checkpoint(name, last_seq) VALUES('QC_LOG', :1)", [int(seq)])
        ora_conn.commit()
    except Exception:
        ora_conn.rollback()
        raise
    finally:
        cur.close()

# ================= FETCH ORACLE =================

def fetch_logs(last_seq):
    cur = ora_conn.cursor()
    try:
        cur.execute(
            "SELECT * FROM hoyav3.dpd_qc_info_agent WHERE seq > :seq ORDER BY seq FETCH FIRST :batch_size ROWS ONLY",
            {"seq": int(last_seq), "batch_size": BATCH_SIZE}
        )
        cols = [c[0].lower() for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return rows
    finally:
        cur.close()

# ================= BUILD ROW =================

def build_row(r):
    qcdate_val = r.get("qcdate")
    month = extract_month(qcdate_val)
    iso_week = extract_iso_week(qcdate_val)
    iso_year = extract_iso_year(qcdate_val)
    
    # Convert status → IS_DELETED (0 or 1)
    status_raw = r.get("status")
    if status_raw:
        status_upper = str(status_raw).strip().upper()
        is_deleted = 1 if status_upper == "DELETE" else 0
    else:
        is_deleted = 0
    
    log.info(f"Status: {status_raw} → IS_DELETED={is_deleted}")
    
    return [
        safe_str(r.get("oid")),
        safe_int(month),
        safe_int(iso_week),
        safe_int(iso_year),
        safe_str(r.get("slipno")),
        safe_int(r.get("diskno")),
        safe_str(r.get("facode")),
        safe_str(r.get("operationoid")),
        safe_str(r.get("operationname")),
        safe_str(r.get("spitemoid")),
        safe_str(r.get("spitemname")),
        safe_str_upper(r.get("stdparamreportname")),
        safe_str(r.get("qcchecksheetname")),
        safe_str_upper(r.get("qcstdparamname")),
        safe_str(r.get("headername")),
        safe_str(r.get("headervalue")),
        safe_str(r.get("paramname")),
        safe_str(r.get("paramvalue")),
        safe_str(r.get("paramrank")),
        safe_str(r.get("profilevalue")),
        safe_str(r.get("correlationvalue")),
        safe_str(r.get("paramjudge")),
        safe_str(r.get("diskjudge")),
        safe_str(r.get("judgment")),
        safe_int(r.get("pddate")),
        safe_int(r.get("qcdate")),
        safe_str(r.get("qcmachineno")),
        safe_int(r.get("qcround")),
        safe_str(r.get("pdshift")),
        safe_int(r.get("pdtime")),
        safe_str(r.get("qcshift")),
        safe_int(r.get("pdprocess")),
        safe_int(r.get("qcprocess")),
        safe_int(r.get("spindleno")),
        safe_str(r.get("ngtype")),
        safe_str(r.get("updateby")),
        safe_datetime_str(r.get("lastupdate")),
        safe_str(r.get("pdmachineno")),
        safe_str(r.get("controllotno")),
        safe_str(r.get("qcterminal")),
        safe_str(r.get("materiallotno")),
        safe_int(r.get("maxpolishround")),
        safe_str(r.get("ismaxqcround")),
        safe_str(r.get("qcworkeroid")),
        safe_str_upper(r.get("stdparamnickname")),
        safe_str(r.get("ngtypename")),
        safe_int(r.get("boxorder")),
        safe_str(r.get("spdisk3")),
        safe_str(r.get("workershift")),
        safe_float(r.get("cul")),
        safe_int(r.get("sul")),
        safe_float(r.get("ul")),
        safe_float(r.get("arul")),
        safe_float(r.get("arll")),
        safe_float(r.get("ll")),
        safe_float(r.get("sll")),
        safe_float(r.get("cll")),
        safe_float(r.get("target")),
        safe_int(r.get("alarm_judge")),
        safe_str(r.get("valueview")),
        safe_int(r.get("calculatebudo")),
        safe_str(r.get("mcline")),
        safe_str(r.get("groupitemoid")),
        safe_str(r.get("groupitemname")),
        safe_str(r.get("mc_2p")),
        safe_int(r.get("date2p")),
        safe_str(r.get("shift2p")),
        safe_int(r.get("ngusl")),
        safe_int(r.get("nglsl")),
        safe_int(r.get("ngucl")),
        safe_int(r.get("nglcl")),
        safe_str(r.get("batchno")),
        safe_int(r.get("batchqty")),
        safe_str(r.get("batchtype")),
        safe_int(r.get("batchseq")),
        safe_int(r.get("mainslipno")),
        safe_int(r.get("seq")),
        safe_int(is_deleted)
    ]

COLUMN_NAMES = [
    "OID", "MONTH", "ISO_WEEK", "ISO_YEAR",
    "SLIPNO", "DISKNO", "FACODE", "OPERATIONOID", "OPERATIONNAME",
    "SPITEMOID", "SPITEMNAME", "STDPARAMREPORTNAME",
    "QCCHECKSHEETNAME", "QCSTDPARAMNAME",
    "HEADERNAME", "HEADERVALUE",
    "PARAMNAME", "PARAMVALUE", "PARAMRANK", "PROFILEVALUE", "CORRELATIONVALUE",
    "PARAMJUDGE", "DISKJUDGE", "JUDGMENT",
    "PDDATE", "QCDATE",
    "QCMACHINENO", "QCROUND", "PDSHIFT", "PDTIME", "QCSHIFT",
    "PDPROCESS", "QCPROCESS", "SPINDLENO",
    "NGTYPE", "UPDATEBY", "LASTUPDATE",
    "PDMACHINENO", "CONTROLLOTNO", "QCTERMINAL", "MATERIALLOTNO",
    "MAXPOLISHROUND", "ISMAXQCROUND", "QCWORKEROID",
    "STDPARAMNICKNAME", "NGTYPENAME", "BOXORDER", "SPDISK3", "WORKERSHIFT",
    "CUL", "SUL", "UL", "ARUL", "ARLL", "LL", "SLL", "CLL",
    "TARGET", "ALARM_JUDGE", "VALUEVIEW",
    "CALCULATEBUDO", "MCLINE", "GROUPITEMOID", "GROUPITEMNAME",
    "MC_2P", "DATE2P", "SHIFT2P",
    "NGUSL", "NGLSL", "NGUCL", "NGLCL",
    "BATCHNO", "BATCHQTY", "BATCHTYPE", "BATCHSEQ", "MAINSLIPNO",
    "SEQ", "IS_DELETED",
]

def push_clickhouse(rows):
    if not rows:
        return 0
    
    rows_with_qcdate = [r for r in rows if r.get("qcdate") is not None]
    rows_without_qcdate = [r for r in rows if r.get("qcdate") is None]
    
    if rows_without_qcdate:
        log.warning(f"Skipping {len(rows_without_qcdate)} rows with NULL QCDATE")
    
    if not rows_with_qcdate:
        log.warning("No rows with valid QCDATE to insert")
        return 0
    
    data = [build_row(r) for r in rows_with_qcdate]
    
    # Debug: show first row data
    if data:
        first_row = data[0]
        log.info(f"DEBUG: First row has {len(first_row)} columns")
        log.info(f"DEBUG: COLUMN_NAMES has {len(COLUMN_NAMES)} columns")
        log.info(f"DEBUG: IS_DELETED value (last col) = {first_row[-1]}")
        log.info(f"DEBUG: Last 5 values = {first_row[-5:]}")
    
    ch_client.insert(CLICKHOUSE_TABLE, data, column_names=COLUMN_NAMES)
    log.info(f"Inserted {len(rows_with_qcdate)} rows (skipped {len(rows_without_qcdate)} with NULL QCDATE)")
    return len(rows_with_qcdate)

def purge_oracle(seq):
    cur = ora_conn.cursor()
    try:
        while True:
            cur.execute("DELETE FROM hoyav3.dpd_qc_info_agent WHERE seq <= :1 AND ROWNUM <= 50000", [int(seq)])
            deleted = cur.rowcount
            ora_conn.commit()
            if deleted == 0:
                break
            log.debug(f"Purged {deleted} rows (seq <= {seq})")
    finally:
        cur.close()

# ================= MAIN =================

def main():
    """One-shot sync: fetch, push, update checkpoint, purge, then exit"""
    try:
        if not connect_oracle():
            log.error("Failed to connect to Oracle")
            return 1
        
        if not connect_clickhouse():
            log.error("Failed to connect to ClickHouse")
            return 1
        
        last_seq = get_last_seq()
        log.info(f"Starting from seq = {last_seq}")
        
        rows = fetch_logs(last_seq)
        
        if not rows:
            log.info("No new data to sync")
            return 0
        
        push_clickhouse(rows)
        new_seq = max(safe_int(r["seq"]) for r in rows)
        update_last_seq(new_seq)
        purge_oracle(new_seq)
        
        log.info(f"Synced {len(rows)} rows → seq {new_seq}")
        return 0
        
    except Exception as e:
        log.error(f"ERROR: {e}", exc_info=True)
        return 1
    finally:
        if ora_conn:
            ora_conn.close()

if __name__ == "__main__":
    sys.exit(main())
