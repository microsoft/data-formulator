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

# Oracle connection string
ORACLE_CONNECTION_STRING = os.environ.get(
    "ORACLE_CONNECTION_STRING",
    (
        "User Id=weboutput;Password=weboutputpwd;"
        "Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)"
        "(HOST=172.25.9.40)(PORT=1521)))"
        "(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));"
    )
)

# ClickHouse connection parameters from environment or defaults
CLICKHOUSE_HOST = os.environ.get("CH_HOST", "172.19.16.23")
CLICKHOUSE_PORT = int(os.environ.get("CH_PORT", "8123"))
CLICKHOUSE_DB = os.environ.get("CH_DB", "QC_DATA")
CLICKHOUSE_USER = os.environ.get("CH_USER", "admin")
CLICKHOUSE_PASS = os.environ.get("CH_PASSWORD", "1fEQlaBivOpYXzw#")

# FIX #1: Đúng tên bảng theo DDL
CLICKHOUSE_TABLE = "DPD_QC_INFO"

BATCH_SIZE  = 50000
SLEEP_TIME  = 0.2
IDLE_SLEEP_TIME = 600  # 10 phút: khi không có dữ liệu để cập nhật
RETRY_DELAY = 3
MAX_RETRIES = 5

# ================= CONNECTION =================

ora_conn  = None
ch_client = None

def parse_oracle_connection_string(conn_str):
    """
    Parse ADO.NET connection string format to extract Oracle connection parameters.
    Format: User Id=...;Password=...;Data Source=(DESCRIPTION=(...))
    Returns dict with user, password, host, port, service_name
    """
    import re
    params = {}
    
    # Extract User Id
    match = re.search(r'User\s+Id\s*=\s*([^;]+)', conn_str, re.IGNORECASE)
    if match:
        params['user'] = match.group(1).strip()
    
    # Extract Password
    match = re.search(r'Password\s*=\s*([^;]+)', conn_str, re.IGNORECASE)
    if match:
        params['password'] = match.group(1).strip()
    
    # Extract HOST from Data Source
    match = re.search(r'\(HOST\s*=\s*([^)]+)\)', conn_str, re.IGNORECASE)
    if match:
        params['host'] = match.group(1).strip()
    
    # Extract PORT from Data Source
    match = re.search(r'\(PORT\s*=\s*(\d+)\)', conn_str, re.IGNORECASE)
    if match:
        params['port'] = int(match.group(1))
    
    # Extract SERVICE_NAME from CONNECT_DATA
    match = re.search(r'\(SERVICE_NAME\s*=\s*([^)]+)\)', conn_str, re.IGNORECASE)
    if match:
        params['service_name'] = match.group(1).strip()
    
    return params

def connect_oracle():
    global ora_conn
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Parse connection string to extract parameters
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
    """
    Chuyển về int (Int32/Int64/UInt64).
    Oracle trả Decimal cho NUMBER column.
    """
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
    """
    FIX #13: Giữ nguyên FULL datetime string (bao gồm giờ:phút:giây)
    vì LASTUPDATE trong ClickHouse là Nullable(String).
    safe_date() cũ chỉ lấy phần ngày → mất thông tin thời gian.
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(val, date):
        return val.strftime("%Y-%m-%d")
    return str(val)

def extract_iso_week(qcdate_val):
    """
    Tính ISO week từ QCDATE (định dạng yyyyMMdd).
    Ví dụ: 20260219 → week 8 của năm 2026
    """
    if qcdate_val is None:
        return None
    try:
        # Chuyển yyyyMMdd thành datetime
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        # Lấy ISO week number (1-53)
        return dt.isocalendar()[1]
    except (ValueError, TypeError):
        return None

def extract_iso_year(qcdate_val):
    """
    Tính ISO year từ QCDATE (định dạng yyyyMMdd).
    Ví dụ: 20260219 → 2026
    """
    if qcdate_val is None:
        return None
    try:
        # Chuyển yyyyMMdd thành datetime
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        # Lấy ISO year
        return dt.isocalendar()[0]
    except (ValueError, TypeError):
        return None

def extract_month(qcdate_val):
    """
    Tính tháng từ QCDATE (định dạng yyyyMMdd).
    Ví dụ: 20260219 → 2 (tháng Hai)
    """
    if qcdate_val is None:
        return None
    try:
        # Chuyển yyyyMMdd thành datetime
        qcdate_str = str(int(qcdate_val))
        if len(qcdate_str) != 8:
            return None
        dt = datetime.strptime(qcdate_str, "%Y%m%d")
        # Lấy month (1-12)
        return dt.month
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
    """
    Map Oracle row → ClickHouse row theo đúng thứ tự COLUMN_NAMES.
    Mỗi cột phải khớp chính xác kiểu dữ liệu trong DDL.

    Mapping kiểu dữ liệu:
      Nullable(String)  → safe_str()
      Nullable(Int64)   → safe_int()
      Nullable(Int32)   → safe_int()   (Python int, CH tự cast về Int32)
      Nullable(Float64) → safe_float()
      UInt64            → safe_int()   (NOT NULL, seq luôn có giá trị)
      UInt8             → 0 hoặc 1     (is_deleted flag)
    """
    # Tính MONTH, ISO week và ISO year từ QCDATE
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
        # ── Metadata ──────────────────────────────────────────────
        safe_str(r.get("oid")),             # OID            Nullable(String)
        safe_int(month),                    # MONTH          Nullable(Int64) ← Tính từ QCDATE
        safe_int(iso_week),                 # ISO_WEEK       Nullable(Int64) ← Tính từ QCDATE
        safe_int(iso_year),                 # ISO_YEAR       Nullable(Int64) ← Tính từ QCDATE

        # ── Slip Info ─────────────────────────────────────────────
        safe_str(r.get("slipno")),          # SLIPNO         Nullable(String)
        safe_int(r.get("diskno")),          # DISKNO         Nullable(Int64)
        safe_str(r.get("facode")),          # FACODE         Nullable(String)
        safe_str(r.get("operationoid")),    # OPERATIONOID   Nullable(String)
        safe_str(r.get("operationname")),   # OPERATIONNAME  Nullable(String)

        # ── Item Info ─────────────────────────────────────────────
        safe_str(r.get("spitemoid")),       # SPITEMOID      Nullable(String)
        safe_str(r.get("spitemname")),      # SPITEMNAME     Nullable(String)
        safe_str(r.get("stdparamreportname")),  # STDPARAMREPORTNAME Nullable(String)

        # ── QC Sheet Info ─────────────────────────────────────────
        safe_str(r.get("qcchecksheetname")),# QCCHECKSHEETNAME Nullable(String)
        safe_str(r.get("qcstdparamname")), # QCSTDPARAMNAME  Nullable(String)
        safe_str(r.get("headername")),     # HEADERNAME      Nullable(String)
        safe_str(r.get("headervalue")),    # HEADERVALUE     Nullable(String)

        # ── Parameter Values ──────────────────────────────────────
        safe_str(r.get("paramname")),      # PARAMNAME       Nullable(String)
        safe_str(r.get("paramvalue")),     # PARAMVALUE      Nullable(String)
        safe_str(r.get("paramrank")),      # PARAMRANK       Nullable(String)
        safe_str(r.get("profilevalue")),   # PROFILEVALUE    Nullable(String)
        safe_str(r.get("correlationvalue")),# CORRELATIONVALUE Nullable(String)

        # ── Judgment ──────────────────────────────────────────────
        safe_str(r.get("paramjudge")),     # PARAMJUDGE      Nullable(String)
        safe_str(r.get("diskjudge")),      # DISKJUDGE       Nullable(String)
        safe_str(r.get("judgment")),       # JUDGMENT        Nullable(String)

        # ── Dates ─────────────────────────────────────────────────
        safe_int(r.get("pddate")),         # PDDATE          Nullable(Int64)
        safe_int(r.get("qcdate")),         # QCDATE          Nullable(Int64)
        # NOTE: QCDATE_PAR là MATERIALIZED column → KHÔNG insert, CH tự tính

        # ── Machine & Process ─────────────────────────────────────
        safe_str(r.get("qcmachineno")),    # QCMACHINENO     Nullable(String)
        safe_int(r.get("qcround")),        # QCROUND         Nullable(Int64)
        safe_str(r.get("pdshift")),        # PDSHIFT         Nullable(String)
        safe_int(r.get("pdtime")),         # PDTIME          Nullable(Int64)  ← FIX #2: safe_str→safe_int
        safe_str(r.get("qcshift")),        # QCSHIFT         Nullable(String)
        safe_int(r.get("pdprocess")),      # PDPROCESS       Nullable(Int64)  ← FIX #3: safe_str→safe_int
        safe_int(r.get("qcprocess")),      # QCPROCESS       Nullable(Int64)  ← FIX #4: safe_str→safe_int
        safe_int(r.get("spindleno")),      # SPINDLENO       Nullable(Int64)  ← FIX #5: safe_str→safe_int

        # ── NG Info ───────────────────────────────────────────────
        safe_str(r.get("ngtype")),         # NGTYPE          Nullable(String)

        # ── Audit ─────────────────────────────────────────────────
        safe_str(r.get("updateby")),       # UPDATEBY        Nullable(String)
        safe_datetime_str(r.get("lastupdate")),# LASTUPDATE  Nullable(String) ← FIX #13: giữ full datetime

        # ── More Machine Info ─────────────────────────────────────
        safe_str(r.get("pdmachineno")),    # PDMACHINENO     Nullable(String)
        safe_str(r.get("controllotno")),   # CONTROLLOTNO    Nullable(String)
        safe_str(r.get("qcterminal")),     # QCTERMINAL      Nullable(String)
        safe_str(r.get("materiallotno")),  # MATERIALLOTNO   Nullable(String)
        safe_int(r.get("maxpolishround")), # MAXPOLISHROUND  Nullable(Int64)
        safe_str(r.get("ismaxqcround")),   # ISMAXQCROUND    Nullable(String) ← FIX #6: safe_int→safe_str
        safe_str(r.get("qcworkeroid")),    # QCWORKEROID     Nullable(String)
        safe_str(r.get("stdparamnickname")),# STDPARAMNICKNAME Nullable(String)
        safe_str(r.get("ngtypename")),     # NGTYPENAME      Nullable(String)
        safe_int(r.get("boxorder")),       # BOXORDER        Nullable(Int64)
        safe_str(r.get("spdisk3")),        # SPDISK3         Nullable(String)
        safe_str(r.get("workershift")),    # WORKERSHIFT     Nullable(String)

        # ── Spec Limits (Float) ───────────────────────────────────
        safe_float(r.get("cul")),          # CUL             Nullable(Float64)
        safe_int(r.get("sul")),            # SUL             Nullable(Int32)  ← FIX #7: safe_float→safe_int
        safe_float(r.get("ul")),           # UL              Nullable(Float64)
        safe_float(r.get("arul")),         # ARUL            Nullable(Float64)
        safe_float(r.get("arll")),         # ARLL            Nullable(Float64)
        safe_float(r.get("ll")),           # LL              Nullable(Float64)
        safe_float(r.get("sll")),          # SLL             Nullable(Float64)
        safe_float(r.get("cll")),          # CLL             Nullable(Float64)
        safe_float(r.get("target")),       # TARGET          Nullable(Float64)
        safe_int(r.get("alarm_judge")),    # ALARM_JUDGE     Nullable(Int64)  ← FIX #8: safe_str→safe_int
        safe_str(r.get("valueview")),      # VALUEVIEW       Nullable(String)

        # ── Budo/Line Info ────────────────────────────────────────
        safe_int(r.get("calculatebudo")),  # CALCULATEBUDO   Nullable(Int64)
        safe_str(r.get("mcline")),         # MCLINE          Nullable(String)
        safe_str(r.get("groupitemoid")),   # GROUPITEMOID    Nullable(String)
        safe_str(r.get("groupitemname")),  # GROUPITEMNAME   Nullable(String)

        # ── 2P Machine Info ───────────────────────────────────────
        safe_str(r.get("mc_2p")),          # MC_2P           Nullable(String)
        safe_int(r.get("date2p")),         # DATE2P          Nullable(Int64)
        safe_str(r.get("shift2p")),        # SHIFT2P         Nullable(String)

        # ── NG Limits (Int) ───────────────────────────────────────
        safe_int(r.get("ngusl")),          # NGUSL           Nullable(Int64)  ← FIX #9:  safe_float→safe_int
        safe_int(r.get("nglsl")),          # NGLSL           Nullable(Int64)  ← FIX #10: safe_float→safe_int
        safe_int(r.get("ngucl")),          # NGUCL           Nullable(Int64)  ← FIX #11: safe_float→safe_int
        safe_int(r.get("nglcl")),          # NGLCL           Nullable(Int64)  ← FIX #12: safe_float→safe_int

        # ── Batch Info ────────────────────────────────────────────
        safe_str(r.get("batchno")),        # BATCHNO         Nullable(String)
        safe_int(r.get("batchqty")),       # BATCHQTY        Nullable(Int64)
        safe_str(r.get("batchtype")),      # BATCHTYPE       Nullable(String)
        safe_int(r.get("batchseq")),       # BATCHSEQ        Nullable(Int64)
        safe_int(r.get("mainslipno")),     # MAINSLIPNO      Nullable(Int64)

        # ── CDC Metadata ──────────────────────────────────────────
        safe_int(r.get("seq")),            # SEQ             UInt64  (NOT NULL)
        safe_int(is_deleted),              # IS_DELETED      UInt8
    ]

# Thứ tự COLUMN_NAMES phải khớp chính xác với build_row() ở trên
# KHÔNG bao gồm QCDATE_PAR vì là MATERIALIZED column
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
    
    # Filter rows with NULL QCDATE (required non-NULL column)
    rows_with_qcdate = [r for r in rows if r.get("qcdate") is not None]
    rows_without_qcdate = [r for r in rows if r.get("qcdate") is None]
    
    if rows_without_qcdate:
        log.warning(f"Skipping {len(rows_without_qcdate)} rows with NULL QCDATE")
    
    if not rows_with_qcdate:
        log.warning("No rows with valid QCDATE to insert")
        return
    
    data = [build_row(r) for r in rows_with_qcdate]
    ch_client.insert(
        CLICKHOUSE_TABLE,   # FIX #1: "DPD_QC_INFO" thay vì "qc_data"
        data,
        column_names=COLUMN_NAMES
    )
    
    log.debug(f"Inserted {len(rows_with_qcdate)} rows (skipped {len(rows_without_qcdate)} with NULL QCDATE)")

# ================= PURGE ORACLE =================

def purge_oracle(seq):
    """
    Xóa log Oracle đã sync thành công.
    Chỉ gọi SAU KHI push_clickhouse + update_last_seq đã thành công.
    """
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

# ================= MAIN LOOP =================

def main():
    """
    Luồng xử lý an toàn (AT-LEAST-ONCE):
      1. fetch_logs         → Lấy batch từ Oracle
      2. push_clickhouse    → Đẩy lên ClickHouse
      3. update_last_seq    → Lưu checkpoint (chỉ khi bước 2 thành công)
      4. purge_oracle       → Xóa Oracle log (chỉ khi bước 3 thành công)

    ClickHouse dùng ReplacingMergeTree(SEQ):
      - Row trùng OID+QCDATE_PAR sẽ giữ bản có SEQ cao nhất
      - IS_DELETED=1 với SEQ cao hơn = soft delete
      - Query cần thêm WHERE IS_DELETED = 0 hoặc dùng FINAL
    """
    connect_oracle()
    connect_clickhouse()

    last_seq = get_last_seq()
    log.info(f"CDC started from seq = {last_seq}")

    consecutive_errors = 0

    while True:
        try:
            ensure_connections()

            rows = fetch_logs(last_seq)

            if not rows:
                log.info(f"No new data. Sleeping for {IDLE_SLEEP_TIME}s (10 minutes)...")
                time.sleep(IDLE_SLEEP_TIME)
                consecutive_errors = 0
                continue

            push_clickhouse(rows)                              # Bước 1

            new_seq = max(safe_int(r["seq"]) for r in rows)
            update_last_seq(new_seq)                           # Bước 2
            last_seq = new_seq

            purge_oracle(last_seq)                             # Bước 3

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