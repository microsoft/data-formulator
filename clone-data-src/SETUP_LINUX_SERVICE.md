# Hướng Dẫn Triển Khai Oracle to ClickHouse Sync Service

## Cải Tiến Chính

### 1. **Giải Quyết Vấn Đề Duplicate Data**

- ✅ **Thay đổi ORDER BY từ LASTUPDATE sang OID**: OID là khóa unique, nên ReplacingMergeTree sẽ hoạt động chính xác
- ✅ **Thêm logic kiểm tra trước insert**: Hàm `get_existing_oids()` lấy tất cả OID đã tồn tại (dùng FINAL)
- ✅ **Version tracking**: Dùng `_version` để tăng version cho update, version 1 cho insert mới

### 2. **Tối Ưu Cho 200 Triệu Records**

- Tăng `batch_size` từ 10,000 lên 50,000 (balance memory vs speed)
- Skip duplicate check trên batch đầu tiên (first sync) → tốc độ nhanh hơn
- Từ batch 2+ mới check duplicates → update records cũ
- Memory usage ổn định vì xử lý từng batch

### 3. **ReplacingMergeTree + FINAL Query**

```sql
-- Schema mới (sử dụng OID làm khóa)
CREATE TABLE dpd_qc_info (
    OID Int64,
    LASTUPDATE DateTime,
    ...
    _version UInt32 DEFAULT 0
) ENGINE = ReplacingMergeTree(_version)
ORDER BY (OID)

-- Khi query, dùng FINAL để lấy record mới nhất
SELECT * FROM dpd_qc_info FINAL WHERE ...
```

## Triển Khai Trên Linux Server

### Bước 1: Chuẩn Bị Thư Mục

```bash
# Tạo thư mục chứa script
mkdir -p /opt/oracle-sync
cd /opt/oracle-sync

# Copy script Python
cp sync_oracle_to_clickhouse.py /opt/oracle-sync/

# Copy service files
cp oracle-clickhouse-sync.service /etc/systemd/system/
cp oracle-clickhouse-sync.timer /etc/systemd/system/
cp oracle-clickhouse-sync-failure.service /etc/systemd/system/

# Cấp quyền
chmod +x /opt/oracle-sync/sync_oracle_to_clickhouse.py
```

### Bước 2: Cập Nhật File Service

Chỉnh sửa `/etc/systemd/system/oracle-clickhouse-sync.service`:

```bash
sudo nano /etc/systemd/system/oracle-clickhouse-sync.service
```

**Thay đổi các dòng này:**

```ini
[Service]
...
WorkingDirectory=/opt/oracle-sync
ExecStart=/usr/bin/python3 /opt/oracle-sync/sync_oracle_to_clickhouse.py
# Nếu dùng virtual environment:
# ExecStart=/opt/oracle-sync/venv/bin/python /opt/oracle-sync/sync_oracle_to_clickhouse.py
```

### Bước 3: Cập Nhật Failure Handler (Optional)

Chỉnh sửa `/etc/systemd/system/oracle-clickhouse-sync-failure.service`:

```bash
sudo nano /etc/systemd/system/oracle-clickhouse-sync-failure.service
```

Thay đổi email:

```ini
ExecStart=/bin/sh -c 'echo "Oracle-ClickHouse sync failed at $(date)" | mail -s "Sync Failure Alert" your-email@example.com'
```

### Bước 4: Load và Kích Hoạt Service

```bash
# Reload systemd configuration
sudo systemctl daemon-reload

# Enable timer (chạy tự động lúc boot)
sudo systemctl enable oracle-clickhouse-sync.timer

# Start timer (khởi động ngay)
sudo systemctl start oracle-clickhouse-sync.timer
```

### Bước 5: Kiểm Tra Status

```bash
# 1. Kiểm tra status service
sudo systemctl status oracle-clickhouse-sync.service

# 2. Kiểm tra timer (lịch chạy 2 tiếng/lần)
sudo systemctl status oracle-clickhouse-sync.timer

# 3. Xem lịch chạy tiếp theo
sudo systemctl list-timers oracle-clickhouse-sync.timer

# 4. Xem logs real-time
sudo journalctl -u oracle-clickhouse-sync -f

# 5. Xem logs 100 dòng cuối
sudo journalctl -u oracle-clickhouse-sync -n 100

# 6. Xem logs từ hôm nay
sudo journalctl -u oracle-clickhouse-sync --since today

# 7. Kiểm tra process chạy
ps aux | grep sync_oracle
```

## Khắc Phục Sự Cố

### Nếu service không chạy:

```bash
# Xem lỗi chi tiết
journalctl -u oracle-clickhouse-sync -n 50 --no-pager

# Test chạy script thủ công (debug)
cd /opt/oracle-sync
python3 sync_oracle_to_clickhouse.py

# Kiểm tra dependencies
pip3 list | grep -E 'oracledb|clickhouse|pandas'
```

### Nếu timer không chạy:

```bash
# Force run ngay (kiểm tra)
sudo systemctl start oracle-clickhouse-sync.service

# Check timer trigger
sudo systemctl status oracle-clickhouse-sync.timer

# View next run time
sudo systemctl list-timers --all
```

### Nếu dữ liệu vẫn duplicate:

1. **Xóa bảng cũ (cảnh báo):**

   ```sql
   -- Backup trước
   CREATE TABLE dpd_qc_info_backup AS SELECT * FROM dpd_qc_info;

   -- Xóa bảng
   DROP TABLE dpd_qc_info;
   ```

2. **Xóa checkpoint để reset sync:**

   ```bash
   rm /opt/oracle-sync/sync_checkpoint.json
   ```

3. **Chạy lại sync (sẽ recreate table):**
   ```bash
   sudo systemctl start oracle-clickhouse-sync.service
   ```

## Thống Kê & Monitoring

### Kiểm tra tiến độ sync:

```sql
-- Xem số records trong ClickHouse
SELECT count(*) FROM dpd_qc_info FINAL;

-- Xem record mới nhất (check LASTUPDATE)
SELECT MAX(LASTUPDATE) FROM dpd_qc_info FINAL;

-- Xem có bao nhiêu version (duplicates):
SELECT count(*) as total, count(DISTINCT OID) as unique_oids
FROM dpd_qc_info;
-- Nếu total > unique_oids → còn duplicates, cần FINAL query
```

### Xem checkpoint hiện tại:

```bash
cat /opt/oracle-sync/sync_checkpoint.json
```

### Xem dung lượng log:

```bash
# Xem dung lượng logs
du -sh /var/log/journal/
journalctl --vacuum-size=1G  # Giữ lại max 1GB logs
```

## Cấu Hình Nâng Cao

### Thay đổi thời gian chạy (VD: 00:00, 06:00, 12:00, 18:00):

```bash
sudo nano /etc/systemd/system/oracle-clickhouse-sync.timer
```

```ini
[Timer]
OnBootSec=5min
# Chạy vào các giờ cụ thể (00:00, 06:00, 12:00, 18:00)
OnCalendar=*-*-* 00,06,12,18:00:00
Persistent=true
```

### Tăng batch size cho performance tốt hơn:

Chỉnh sửa `sync_oracle_to_clickhouse.py`:

```python
batch_size = 100000  # Từ 50000 → 100000 (nếu memory cho phép)
```

## Lệnh Hữu Ích

```bash
# Dừng service
sudo systemctl stop oracle-clickhouse-sync.timer

# Restart service
sudo systemctl restart oracle-clickhouse-sync.timer

# Disable (không chạy khi boot)
sudo systemctl disable oracle-clickhouse-sync.timer

# Xem status tất cả timers
sudo systemctl list-timers

# Force run ngay (không đợi 2 giờ)
sudo systemctl start oracle-clickhouse-sync.service

# Xem environment variables
sudo systemctl show oracle-clickhouse-sync.service
```

## Notes Quan Trọng

1. **ReplacingMergeTree:** Tự động xóa duplicates khi MERGE, nhưng phải dùng `FINAL` query để đảm bảo lấy record mới nhất
2. **Performance:** Với 200M records, query `FINAL` sẽ chậm. Cân nhắc dùng view hoặc materialized view
3. **Backup:** Luôn backup dữ liệu trước khi thay đổi schema
4. **Monitoring:** Set up alerting nếu sync fail (xem phần failure handler)
