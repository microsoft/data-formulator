# Lịch biểu chạy Sync Data với Cron Job

## Lựa chọn 1: Sử dụng `sync-once.py` (khuyến cáo)

`sync-once.py` là bản chạy **một lần rồi thoát**, thích hợp cho cron job.

### Setup trên Linux

#### Bước 1: Copy file lên server

```bash
scp clone-data-src/sync-once.py user@linux-server:/path/to/clone-data-src/
scp clone-data-src/requirements-sync.txt user@linux-server:/path/to/clone-data-src/
```

#### Bước 2: Cài đặt dependencies

```bash
ssh user@linux-server
cd /path/to/clone-data-src

# Cài pip packages
pip install -r requirements-sync.txt

# Hoặc nếu dùng virtual environment:
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-sync.txt
```

#### Bước 3: Test chạy thử

```bash
# Chạy một lần để test
python3 sync-once.py

# Xem logs
tail -f /tmp/sync.log  # Nếu redirect stdout
```

#### Bước 4: Setup Cron Job

```bash
# Mở crontab editor
crontab -e
```

**Ví dụ: Chạy mỗi 30 phút một lần**

```cron
# Chạy mỗi 30 phút từ 6h sáng đến 10h tối
*/30 6-22 * * * cd /path/to/clone-data-src && python3 sync-once.py >> /var/log/sync-once.log 2>&1

# Hoặc chạy mỗi 15 phút
*/15 * * * * cd /path/to/clone-data-src && python3 sync-once.py >> /var/log/sync-once.log 2>&1

# Hoặc chỉ 1 lần mỗi giờ
0 * * * * cd /path/to/clone-data-src && python3 sync-once.py >> /var/log/sync-once.log 2>&1

# Hoặc 1 lần mỗi 3 giờ
0 */3 * * * cd /path/to/clone-data-src && python3 sync-once.py >> /var/log/sync-once.log 2>&1

# Hoặc 1 lần mỗi ngày lúc 2 giờ sáng
0 2 * * * cd /path/to/clone-data-src && python3 sync-once.py >> /var/log/sync-once.log 2>&1
```

#### Bước 5: Kiểm tra cron job

```bash
# Xem danh sách cron job
crontab -l

# Xem logs cron (nếu enable)
sudo journalctl -u cron
# hoặc
tail -f /var/log/syslog | grep CRON

# Xem logs của chương trình
tail -f /var/log/sync-once.log
```

#### Bước 6: Set environment variables (nếu khác default)

Nếu cần custom connection parameters, tạo file `.env`:

```bash
cat > /path/to/clone-data-src/.env << 'EOF'
ORACLE_CONNECTION_STRING=User Id=weboutput;Password=weboutputpwd;Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=172.25.9.40)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));
CH_HOST=172.19.16.23
CH_PORT=8123
CH_USER=admin
CH_PASSWORD=1fEQlaBivOpYXzw#
CH_DB=QC_DATA
EOF
```

Rồi update cron command để load .env:

```cron
*/30 * * * * cd /path/to/clone-data-src && source .env && python3 sync-once.py >> /var/log/sync-once.log 2>&1
```

---

## Lựa chọn 2: Systemd Timer (alternative)

Thay vì cron, dùng systemd timer (hiện đại hơn).

### Setup

#### Bước 1: Tạo systemd service file

```bash
sudo nano /etc/systemd/system/dpd-qc-sync.service
```

```ini
[Unit]
Description=DPD QC Data Sync (One-shot)
After=network.target

[Service]
Type=oneshot
User=<your-user>
WorkingDirectory=/path/to/clone-data-src
EnvironmentFile=/path/to/clone-data-src/.env
ExecStart=/usr/bin/python3 sync-once.py
StandardOutput=journal
StandardError=journal
```

#### Bước 2: Tạo systemd timer file

```bash
sudo nano /etc/systemd/system/dpd-qc-sync.timer
```

```ini
[Unit]
Description=DPD QC Data Sync Timer
Requires=dpd-qc-sync.service

[Timer]
# Chạy mỗi 30 phút
OnBootSec=5min
OnUnitActiveSec=30min
AccuracySec=1min

# Hoặc chạy lúc cố định (6h sáng):
# OnCalendar=*-*-* 06:00:00
# OnCalendar=*-*-* 06:00:00,10:00:00,14:00:00  # 6h, 10h, 14h
# OnCalendar=*-*-* 00:00:00  # Mỗi ngày lúc 0h

[Install]
WantedBy=timers.target
```

#### Bước 3: Enable và start

```bash
sudo systemctl daemon-reload
sudo systemctl enable dpd-qc-sync.timer
sudo systemctl start dpd-qc-sync.timer

# Kiểm tra status
sudo systemctl status dpd-qc-sync.timer
sudo systemctl list-timers dpd-qc-sync.timer

# Xem logs
sudo journalctl -u dpd-qc-sync.service -f
```

---

## Lựa chọn 3: Chạy Docker với cron

Nếu vẫn muốn dùng Docker nhưng chạy theo lịch:

```cron
# Build image (1 lần cuối cùng)
# docker build -t dpd-qc-sync:latest /path/to/clone-data-src

# Chạy container mỗi 30 phút
*/30 * * * * docker run --rm \
  -e ORACLE_CONNECTION_STRING="..." \
  -e CH_HOST=172.19.16.23 \
  dpd-qc-sync:latest
```

---

## So sánh các cách

| Phương pháp             | Ưu điểm                             | Nhược điểm          |
| ----------------------- | ----------------------------------- | ------------------- |
| **Cron + sync-once.py** | Đơn giản, nhẹ, không cần Docker     | Cần cài Python      |
| **Systemd Timer**       | Hiện đại, integrate tốt, có logging | Phức tạp hơn cron   |
| **Docker + Cron**       | Isolated, dễ deploy                 | Nặng, chậm hơn      |
| **Docker Realtime**     | Đơn giản                            | Lưu tài nguyên 24/7 |

**Khuyến cáo:** Dùng **Cron + sync-once.py** (đơn giản) hoặc **Systemd Timer** (nếu muốn modern).
