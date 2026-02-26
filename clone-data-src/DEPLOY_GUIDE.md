# Quick Start Guide - Deploy to Linux Server

## 📋 Tóm tắt

Mang script từ máy tính lên Linux server và chạy tự động mỗi ngày.

---

## 🚀 Cách 1: Deployment Script (Recommended - Fastest)

### Trên máy tính của bạn (Windows/Mac/Linux):

```bash
# Vào thư mục chứa script
cd clone-data-src

# Chạy deploy script
bash deploy_to_linux.sh

# Nhập thông tin:
# - Server: user@your-server-ip (e.g., admin@192.168.1.100)
# - Deploy path: /opt/data-sync (hoặc path khác)
```

Script sẽ tự động:
✅ Tạo thư mục trên server  
✅ Copy các file cần thiết  
✅ Set permissions  
✅ Test kết nối  
✅ Setup automation (systemd hoặc cron)

---

## 🚀 Cách 2: Manual Deployment (Step-by-step)

### Bước 1: Copy files lên server

```bash
# Từ máy tính (Windows PowerShell hoặc Linux terminal)
scp clone-data-src/sync_oracle_to_clickhouse.py admin@192.168.1.100:/opt/data-sync/
scp clone-data-src/setup_daily_sync.sh admin@192.168.1.100:/opt/data-sync/
scp clone-data-src/test_sync_connection.sh admin@192.168.1.100:/opt/data-sync/

# Hoặc copy toàn bộ thư mục
scp -r clone-data-src admin@192.168.1.100:/opt/
```

### Bước 2: SSH vào server

```bash
ssh admin@192.168.1.100
cd /opt/data-sync
```

### Bước 3: Test kết nối trước

```bash
bash test_sync_connection.sh
```

Output nếu thành công:

```
✓ Oracle connection successful - table dpd_qc_info found
✓ ClickHouse connection successful at 172.19.16.23:8123
✓ Both connections successful - ready to run sync
```

### Bước 4: Setup Automation

**Option A: Systemd (Recommended)**

```bash
# Requires root/sudo
sudo bash setup_daily_sync.sh systemd
```

Advantages:

- ✅ Chạy tự động lúc 2:00 AM hàng ngày
- ✅ Restart lại nếu fail
- ✅ Monitor qua journalctl
- ✅ Chạy ngay cả khi không có ai đăng nhập

**Option B: Cron**

```bash
bash setup_daily_sync.sh cron
```

Advantages:

- ✅ Không cần root
- ✅ Log được lưu vào file

### Bước 5: Kiểm tra status

**Với systemd:**

```bash
# Xem schedule
sudo systemctl list-timers oracle-clickhouse-sync

# Xem logs real-time
sudo journalctl -u oracle-clickhouse-sync -f

# Xem status
sudo systemctl status oracle-clickhouse-sync
```

**Với cron:**

```bash
# Xem cron job
crontab -l

# Xem logs
tail -f /opt/data-sync/logs/sync*.log
```

---

## 📊 Chạy Manual Test

```bash
# SSH vào server
ssh admin@192.168.1.100
cd /opt/data-sync

# Chạy ngay (không chờ 2 AM)
python3 sync_oracle_to_clickhouse.py

# Hoặc qua virtual environment
source venv/bin/activate
python sync_oracle_to_clickhouse.py
```

Xem log real-time:

```bash
tail -f logs/sync_*.log
```

---

## ⚙️ Cấu hình Environment Variables (Optional)

Nếu muốn thay đổi ClickHouse connection parameters:

**Tạo file .env:**

```bash
nano /opt/data-sync/.env
```

Thêm vào:

```
CH_HOST=172.19.16.23
CH_PORT=8123
CH_USER=admin
CH_PASSWORD=your_password_here
CH_DB=QC_DATA
```

**Source trước khi chạy:**

```bash
source /opt/data-sync/.env
python sync_oracle_to_clickhouse.py
```

---

## 📝 File Structure trên Server

```
/opt/data-sync/
├── sync_oracle_to_clickhouse.py    # Main script
├── setup_daily_sync.sh              # Setup automation
├── test_sync_connection.sh          # Test connections
├── SYNC_SETUP_GUIDE.md             # Documentation
├── .env                            # Environment (optional)
├── sync_checkpoint.json            # Last sync checkpoint (auto-created)
├── venv/                           # Virtual environment (auto-created)
│   ├── bin/python
│   ├── bin/pip
│   └── lib/
└── logs/                           # Logs (auto-created)
    ├── sync_oracle_to_clickhouse_20260211.log
    ├── sync_oracle_to_clickhouse_20260212.log
    └── sync_checkpoint.json
```

---

## 🐛 Troubleshooting

### Lỗi: "Permission denied"

```bash
# Fix
chmod +x *.sh
sudo chmod 755 /opt/data-sync
```

### Lỗi: "Oracle connection failed"

- Check firewall: `telnet 172.25.9.40 1521`
- Check credentials trong script
- Check network từ server

### Lỗi: "ClickHouse connection failed"

- Check IP/port: `telnet 172.19.16.23 8123`
- Check password
- Check network từ server

### Systemd không hoạt động

```bash
# Check status
sudo systemctl status oracle-clickhouse-sync.timer

# View journal
sudo journalctl -u oracle-clickhouse-sync -n 50 --no-pager

# Manual trigger
sudo systemctl start oracle-clickhouse-sync
```

### Cron không chạy

```bash
# Check cron daemon
sudo service cron status

# Check cron logs (varies by OS)
sudo grep CRON /var/log/syslog      # Ubuntu/Debian
sudo grep CRON /var/log/messages    # RHEL/CentOS

# Check cron job
crontab -l

# View all cron logs
sudo tail -f /var/log/syslog | grep CRON
```

---

## 📊 Monitoring Commands

```bash
# View checkpoint
cat /opt/data-sync/sync_checkpoint.json

# Check ClickHouse table
clickhouse-client --host 172.19.16.23 --user admin --password
> SELECT COUNT(*) FROM QC_DATA.dpd_qc_info FINAL;

# View last 50 logs
tail -50 /opt/data-sync/logs/sync_*.log

# Search logs for errors
grep ERROR /opt/data-sync/logs/sync_*.log

# Watch real-time logs
watch -n 1 'ls -lh /opt/data-sync/logs/sync_*.log'
```

---

## 💡 Tips

1. **First run**: Sẽ sao chép tất cả records từ Oracle
2. **Incremental**: Lần tiếp theo chỉ sao chép records mới
3. **No new data**: Nếu không có records mới, script sẽ skip (không làm gì)
4. **Duplicates**: ReplacingMergeTree tự động xử lý duplicates
5. **Logs**: Luôn kiểm tra logs để debug

---

## ⏰ Scheduling

Mặc định chạy lúc **2:00 AM hàng ngày** (UTC)

Để thay đổi time:

```bash
# Edit systemd timer
sudo nano /etc/systemd/system/oracle-clickhouse-sync.timer

# Change this line:
# OnCalendar=*-*-* 02:00:00
# To: OnCalendar=*-*-* 10:00:00  (10 AM)

sudo systemctl daemon-reload
sudo systemctl restart oracle-clickhouse-sync.timer
```

Hoặc cron:

```bash
crontab -e

# Change this:
# 0 2 * * * /opt/data-sync/run_sync.sh
# To: 0 10 * * * /opt/data-sync/run_sync.sh (10 AM)
```
