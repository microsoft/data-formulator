#!/usr/bin/env python3
"""
Sync data từ Oracle → ClickHouse với scheduled cleanup
Cleanup chạy tự động lúc 0h đêm và 12h trưa mỗi ngày
Chỉ giữ lại bản ghi có SEQ cao nhất (FINAL) cho mỗi OID + QCDATE_PAR
"""

import oracledb
import clickhouse_connect
import time
import logging
import os
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

BATCH_SIZE = 50000
SLEEP_TIME = 0.2
IDLE_SLEEP_TIME = 600  # 10 phút: khi không có dữ liệu để cập nhật
RETRY_DELAY = 3
MAX_RETRIES = 5

# ── Thời điểm chạy cleanup mỗi ngày ──────────────────────────────────────────
CLEANUP_HOURS = {0, 12}  # 0h đêm (00:00) và 12h trưa (12:00)

# Lưu lại thời điểm chạy cleanup gần nhất để tránh chạy lặp lại
# trong cùng 1 giờ (vì main loop chạy nhiều lần trong 1 giờ)
_last_cleanup_hour = -1
_last_cleanup_date = None

# ================= CONNECTION =================

ora_conn = None
ch_client = None

def parse_oracle_connection_string(conn_str):
    """Parse ADO.NET connection string format to extract Oracle connection parameters."""
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
            return
        except Exception as e:
            log.warning(f"Oracle connect attempt {attempt}/{MAX_RETRIES} failed: {e}")
            time.sleep(RETRY_DELAY * attempt)
    raise RuntimeError("Cannot connect to Oracle after max retries.")

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
            return
        except Exception as e:
            log.warning(f"ClickHouse connect attempt {attempt}/{MAX_RETRIES} failed: {e}")
            time.sleep(RETRY_DELAY * attempt)
    raise RuntimeError("Cannot connect to ClickHouse after max retries.")

def ensure_connections():
    global ora_conn, ch_client
    try:
        cur = ora_conn.cursor()
        cur.execute("SELECT 1 FROM DUAL")
        cur.close()
    except Exception:
        log.warning("Oracle connection lost. Reconnecting...")
        connect_oracle()
    try:
        ch_client.query("SELECT 1")
    except Exception:
        log.warning("ClickHouse connection lost. Reconnecting...")
        connect_clickhouse()

# ================= TYPE HELPERS =================

def safe_int(val):
    """Chuyển về int (Int32/Int64/UInt64). Oracle trả Decimal cho NUMBER column."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None

def safe_float(val):
    """Chuyển về float (Float64)."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def safe_str(val):
    """Trả về string hoặc None."""
    if val is None:
        return None
    return str(val)

def safe_datetime_str(val):
    """Giữ nguyên FULL datetime string (bao gồm giờ:phút:giây)."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(val, date):
        return val.strftime("%Y-%m-%d")
    return str(val)

def extract_month(qcdate_val):
    """Tính tháng từ QCDATE (định dạng yyyyMMdd). Ví dụ: 20260219 → 2 (tháng Hai)"""
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
    """Tính ISO week từ QCDATE (định dạng yyyyMMdd). Ví dụ: 20260219 → week 8 của năm 2026"""
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
    """Tính ISO year từ QCDATE (định dạng yyyyMMdd). Ví dụ: 20260219 → 2026"""
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
        cur.execute(
            "SELECT last_seq FROM hoyav3.sync_checkpoint WHERE name = 'QC_LOG'"
        )
        row = cur.fetchone()
        if row and row[0] is not None:
            return safe_int(row[0])
        return 0
    finally:
        cur.close()

def update_last_seq(seq):
    cur = ora_conn.cursor()
    try:
        cur.execute(
            "UPDATE hoyav3.sync_checkpoint SET last_seq = :1 WHERE name = 'QC_LOG'",
            [int(seq)]
        )
        if cur.rowcount == 0:
            cur.execute(
                "INSERT INTO hoyav3.sync_checkpoint(name, last_seq) VALUES('QC_LOG', :1)",
                [int(seq)]
            )
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
            """
            SELECT *
            FROM hoyav3.dpd_qc_info_agent
            WHERE seq > :seq
            ORDER BY seq
            FETCH FIRST :batch_size ROWS ONLY
            """,
            {"seq": int(last_seq), "batch_size": BATCH_SIZE}
        )
        cols = [c[0].lower() for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return rows
    finally:
        cur.close()

# ================= BUILD ROW =================

def build_row(r):
    """Map Oracle row → ClickHouse row theo đúng thứ tự COLUMN_NAMES."""
    qcdate_val = r.get("qcdate")
    month = extract_month(qcdate_val)
    iso_week = extract_iso_week(qcdate_val)
    iso_year = extract_iso_year(qcdate_val)
    
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
        safe_str(r.get("stdparamreportname")),
        safe_str(r.get("qcchecksheetname")),
        safe_str(r.get("qcstdparamname")),
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
        safe_str(r.get("stdparamnickname")),
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
        1 if r.get("status") == "DELETE" else 0,
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
        return
    
    rows_with_qcdate = [r for r in rows if r.get("qcdate") is not None]
    rows_without_qcdate = [r for r in rows if r.get("qcdate") is None]
    
    if rows_without_qcdate:
        log.warning(f"Skipping {len(rows_without_qcdate)} rows with NULL QCDATE")
    
    if not rows_with_qcdate:
        log.warning("No rows with valid QCDATE to insert")
        return
    
    data = [build_row(r) for r in rows_with_qcdate]
    ch_client.insert(CLICKHOUSE_TABLE, data, column_names=COLUMN_NAMES)
    log.debug(f"Inserted {len(rows_with_qcdate)} rows (skipped {len(rows_without_qcdate)} with NULL QCDATE)")

# ================= PURGE ORACLE =================

def purge_oracle(seq):
    """Xóa log Oracle đã sync thành công."""
    cur = ora_conn.cursor()
    try:
        while True:
            cur.execute(
                """
                DELETE FROM hoyav3.dpd_qc_info_agent
                WHERE seq <= :1
                AND ROWNUM <= 50000
                """,
                [int(seq)]
            )
            deleted = cur.rowcount
            ora_conn.commit()
            if deleted == 0:
                break
            log.debug(f"Purged {deleted} rows (seq <= {seq})")
    finally:
        cur.close()

# ================= CLEANUP LOGIC =================

def should_run_cleanup() -> bool:
    """
    Trả về True nếu hiện tại là 0h đêm hoặc 12h trưa
    VÀ chưa chạy cleanup trong giờ này hôm nay.
    """
    global _last_cleanup_hour, _last_cleanup_date

    now = datetime.now()
    now_hour = now.hour
    now_date = now.date()

    if now_hour not in CLEANUP_HOURS:
        return False

    # Đã chạy cleanup trong giờ này hôm nay rồi → bỏ qua
    if now_date == _last_cleanup_date and now_hour == _last_cleanup_hour:
        return False

    return True

def reset_cleanup_state():
    """Lưu lại thời điểm vừa chạy cleanup để không chạy lại trong cùng giờ."""
    global _last_cleanup_hour, _last_cleanup_date
    now = datetime.now()
    _last_cleanup_hour = now.hour
    _last_cleanup_date = now.date()

def cleanup_old_versions():
    """
    Xóa các bản ghi cũ (SEQ nhỏ hơn) trong ClickHouse.
    Chỉ giữ lại bản ghi có SEQ lớn nhất cho mỗi OID + QCDATE_PAR.
    Dùng ALTER TABLE DELETE (mutation) → chạy async, không block query.
    """
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log.info(f"[{now_str}] Starting scheduled cleanup...")

        # Bước 1: Kiểm tra có mutation nào đang chạy không
        result = ch_client.query("""
            SELECT COUNT(*) as cnt
            FROM system.mutations
            WHERE table = 'DPD_QC_INFO'
              AND database = 'QC_DATA'
              AND is_done = 0
        """)
        
        if result.row_count > 0:
            running_mutations = result.first_row[0] if result.first_row else 0
            if running_mutations > 0:
                log.info(f"Skipping cleanup: {running_mutations} mutation(s) still running.")
                reset_cleanup_state()
                return

        # Bước 2: Chạy cleanup — xóa bản cũ không phải MAX(SEQ)
        log.info("Executing cleanup mutation to remove duplicate old versions...")
        ch_client.command("""
            ALTER TABLE DPD_QC_INFO
            DELETE WHERE (OID, QCDATE_PAR, SEQ) NOT IN (
                SELECT OID, QCDATE_PAR, MAX(SEQ) as max_seq
                FROM DPD_QC_INFO
                WHERE IS_DELETED = 0
                GROUP BY OID, QCDATE_PAR
            )
        """)

        log.info("✓ Cleanup mutation submitted successfully. Old duplicates will be removed asynchronously.")

    except Exception as e:
        # Cleanup thất bại KHÔNG được làm crash pipeline chính
        log.error(f"Cleanup failed (non-critical): {e}")

    finally:
        # Dù thành công hay lỗi đều reset để không chạy lại trong giờ này
        reset_cleanup_state()

# ================= MAIN LOOP =================

def main():
    """
    Luồng xử lý an toàn (AT-LEAST-ONCE) với scheduled cleanup:
      1. fetch_logs         → Lấy batch từ Oracle
      2. push_clickhouse    → Đẩy lên ClickHouse
      3. update_last_seq    → Lưu checkpoint
      4. purge_oracle       → Xóa Oracle log
      5. cleanup (if scheduled) → Xóa duplicate cũ
    """
    connect_oracle()
    connect_clickhouse()

    last_seq = get_last_seq()
    log.info(f"CDC started from seq = {last_seq}")
    log.info(f"Scheduled cleanup: {CLEANUP_HOURS} (UTC/local time)")

    consecutive_errors = 0

    while True:
        try:
            ensure_connections()

            # ── Kiểm tra lịch cleanup trước mỗi vòng lặp ────────────────────
            if should_run_cleanup():
                cleanup_old_versions()

            rows = fetch_logs(last_seq)

            if not rows:
                log.info(f"No new data. Sleeping for {IDLE_SLEEP_TIME}s (10 minutes)...")
                time.sleep(IDLE_SLEEP_TIME)
                consecutive_errors = 0
                continue

            push_clickhouse(rows)

            new_seq = max(safe_int(r["seq"]) for r in rows)
            update_last_seq(new_seq)
            last_seq = new_seq

            purge_oracle(last_seq)

            log.info(f"Synced {len(rows)} rows → seq {last_seq}")
            consecutive_errors = 0

        except KeyboardInterrupt:
            log.info("Stopped by user.")
            break

        except Exception as e:
            consecutive_errors += 1
            log.error(f"ERROR (attempt {consecutive_errors}): {e}", exc_info=True)
            wait = min(RETRY_DELAY * consecutive_errors, 30)
            log.info(f"Retrying in {wait}s...")
            time.sleep(wait)
            if consecutive_errors >= 3:
                try:
                    connect_oracle()
                    connect_clickhouse()
                except Exception as conn_err:
                    log.error(f"Reconnect failed: {conn_err}")

if __name__ == "__main__":
    main()
