# DPD QC Data Sync - Docker Deployment Guide

## Cấu trúc file

```
clone-data-src/
├── sync-code.py              # Chương trình chính
├── requirements-sync.txt     # Dependencies
├── Dockerfile                # Docker image definition
├── docker-compose.yml        # Orchestration file
├── .dockerignore             # Exclude files from Docker
└── .env                       # Environment variables (tuỳ chọn)
```

## Hướng dẫn sử dụng

### 1. Chuẩn bị trên máy Linux

```bash
# Copy toàn bộ thư mục lên server
scp -r clone-data-src/ user@linux-server:/path/to/destination/

# SSH vào server
ssh user@linux-server
cd /path/to/destination/clone-data-src/
```

### 2. Tạo file `.env` (tuỳ chọn)

```bash
cat > .env << 'EOF'
# Oracle connection string
ORACLE_CONNECTION_STRING=User Id=weboutput;Password=weboutputpwd;Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=172.25.9.40)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));

# ClickHouse
CH_HOST=172.19.16.23
CH_PORT=8123
CH_USER=admin
CH_PASSWORD=1fEQlaBivOpYXzw#
CH_DB=QC_DATA
EOF
```

### 3. Build Docker image

```bash
# Build image
docker build -t dpd-qc-sync:latest .

# Hoặc sử dụng docker-compose
docker-compose build
```

### 4. Chạy container

#### Cách 1: Sử dụng docker-compose (khuyến cáo)

```bash
# Chạy ở background
docker-compose up -d

# Xem logs
docker-compose logs -f sync-service

# Dừng service
docker-compose down
```

#### Cách 2: Sử dụng docker run

```bash
docker run -d \
  --name dpd-qc-sync \
  --restart always \
  -e ORACLE_CONNECTION_STRING="User Id=weboutput;Password=weboutputpwd;Data Source=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=172.25.9.40)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=HOYAV3)));" \
  -e CH_HOST=172.19.16.23 \
  -e CH_PORT=8123 \
  -e CH_USER=admin \
  -e CH_PASSWORD=1fEQlaBivOpYXzw# \
  -e CH_DB=QC_DATA \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  dpd-qc-sync:latest
```

### 5. Quản lý container

```bash
# Xem status
docker-compose ps
# hoặc
docker ps -a | grep dpd-qc-sync

# Xem logs
docker-compose logs sync-service
docker-compose logs -f sync-service  # Real-time

# Dừng
docker-compose stop sync-service

# Khởi động lại
docker-compose restart sync-service

# Xóa container
docker-compose down

# Xem chi tiết lỗi
docker-compose logs --tail 100 sync-service
```

## Các biến môi trường

| Biến                       | Default            | Mô tả                                |
| -------------------------- | ------------------ | ------------------------------------ |
| `ORACLE_CONNECTION_STRING` | Giá trị mặc định   | ADO.NET connection string cho Oracle |
| `CH_HOST`                  | `172.19.16.23`     | ClickHouse host                      |
| `CH_PORT`                  | `8123`             | ClickHouse port                      |
| `CH_USER`                  | `admin`            | ClickHouse username                  |
| `CH_PASSWORD`              | `1fEQlaBivOpYXzw#` | ClickHouse password                  |
| `CH_DB`                    | `QC_DATA`          | ClickHouse database                  |

## Troubleshooting

### Lỗi kết nối Oracle

```
oracledb.exceptions.DatabaseError: DPY-4027: no configuration directory specified
```

→ Kiểm tra connection string format đúng chưa (xem ORACLE_CONNECTION_STRING)

### Lỗi kết nối ClickHouse

```
Cannot connect to ClickHouse
```

→ Kiểm tra:

- ClickHouse service đang chạy?
- Firewall có chặn port 8123?
- Credentials đúng chưa?

### Container không khởi động

```bash
# Xem detailed error logs
docker-compose logs sync-service

# Hoặc run in foreground để debug
docker-compose run --rm sync-service
```

### Xoá toàn bộ và reset

```bash
# Dừng và xoá container
docker-compose down -v

# Xoá image
docker rmi dpd-qc-sync:latest

# Rebuild
docker-compose build --no-cache
docker-compose up -d
```

## Systemd Service (tuỳ chọn)

Nếu muốn Docker container tự khởi động khi reboot server:

```bash
# Tạo systemd service file
sudo nano /etc/systemd/system/dpd-qc-sync.service
```

```ini
[Unit]
Description=DPD QC Data Sync Service
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/path/to/clone-data-src
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
# Enable và start service
sudo systemctl daemon-reload
sudo systemctl enable dpd-qc-sync.service
sudo systemctl start dpd-qc-sync.service

# Kiểm tra status
sudo systemctl status dpd-qc-sync.service
```

## Notes

- Docker image được build dựa trên `python:3.11-slim`
- Logs được lưu với format JSON, max 10MB mỗi file, tối đa 3 files
- Memory limit: 1GB, CPU limit: 2 cores
- Auto restart policy: always
