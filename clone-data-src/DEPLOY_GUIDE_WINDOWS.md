# Windows Deployment Guide

## 🪟 Deploy từ Windows

Nếu bạn đang trên Windows, có 3 cách deploy:

---

## Cách 1: PowerShell Script (Recommended)

### Yêu cầu:

- Windows PowerShell 5.0+
- SSH client (Git Bash hoặc OpenSSH)

### Bước 1: Cài đặt SSH (nếu chưa có)

**Option A: Git Bash (Easier)**

```powershell
# Download and install: https://git-scm.com/download/win
# Hoặc dùng Chocolatey
choco install git
```

**Option B: OpenSSH (Built-in trên Windows 10+)**

```powershell
# Open Settings > Apps > Apps & Features > Optional Features
# Add: OpenSSH Client
# Hoặc qua PowerShell:
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### Bước 2: Chạy PowerShell script

```powershell
# Mở PowerShell (Windows key + R, gõ "powershell")
cd D:\THANHBV\AI\data-formulator\clone-data-src

# Cho phép chạy scripts (chỉ cần 1 lần)
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser

# Chạy deploy script
.\deploy_to_linux.ps1
```

**Nhập thông tin:**

```
Server: admin@192.168.1.100
Deploy path: /opt/data-sync
Setup method: 1 (systemd)
```

**Done!** ✅

---

## Cách 2: Batch Script

### Yêu cầu:

- SSH client
- Windows CMD

### Bước 1: Mở CMD

```cmd
# Windows key + R
# Gõ: cmd
```

### Bước 2: Chạy batch file

```cmd
cd D:\THANHBV\AI\data-formulator\clone-data-src
deploy_to_linux.bat
```

---

## Cách 3: Manual (No Scripts)

Nếu scripts không hoạt động, copy files manually:

### Bước 1: Copy files qua SCP

**PowerShell:**

```powershell
$server = "admin@192.168.1.100"
$path = "/opt/data-sync"

# Copy Python script
scp sync_oracle_to_clickhouse.py "${server}:${path}/"

# Copy setup scripts
scp setup_daily_sync.sh "${server}:${path}/"
scp test_sync_connection.sh "${server}:${path}/"
```

**CMD:**

```cmd
set SERVER=admin@192.168.1.100
set PATH=/opt/data-sync

REM Copy files
scp sync_oracle_to_clickhouse.py %SERVER%:%PATH%/
scp setup_daily_sync.sh %SERVER%:%PATH%/
scp test_sync_connection.sh %SERVER%:%PATH%/
```

### Bước 2: SSH vào server

```powershell
ssh admin@192.168.1.100
```

### Bước 3: Setup trên server

```bash
cd /opt/data-sync

# Test connection
bash test_sync_connection.sh

# Setup automation
sudo bash setup_daily_sync.sh systemd
```

---

## Cách 4: WinSCP GUI (Easiest for GUI Users)

Nếu không thích command line:

1. **Download WinSCP**: https://winscp.net/download/WinSCP-6.3.5-Setup.exe
2. **Create new connection:**
   - Host: 192.168.1.100
   - User: admin
   - Password: your_password
3. **Drag & drop files:**
   - Local: D:\THANHBV\AI\data-formulator\clone-data-src\
   - Remote: /opt/data-sync/
4. **Run commands qua terminal** (Ctrl + T):
   ```bash
   chmod +x /opt/data-sync/*.sh
   cd /opt/data-sync
   bash test_sync_connection.sh
   sudo bash setup_daily_sync.sh systemd
   ```

---

## Troubleshooting

### ❌ "ssh is not recognized"

**Cài đặt Git Bash:**

```powershell
# Option 1: Chocolatey
choco install git

# Option 2: Direct download
# https://git-scm.com/download/win
```

**Hoặc enable OpenSSH:**

```powershell
# Windows 10/11
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### ❌ "Permission denied (publickey)"

**Tạo SSH key:**

```powershell
ssh-keygen -t rsa -b 4096 -f $env:USERPROFILE\.ssh\id_rsa

# Copy public key to server
scp $env:USERPROFILE\.ssh\id_rsa.pub admin@192.168.1.100:/tmp/
```

**Trên server:**

```bash
cat /tmp/id_rsa.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### ❌ "Connection refused"

- Kiểm tra server address: `ping 192.168.1.100`
- Kiểm tra SSH port: `telnet 192.168.1.100 22`
- Kiểm tra firewall rules

---

## ✅ Verify Deploy

Sau khi deploy xong:

```powershell
# SSH vào server
ssh admin@192.168.1.100

# Check files
ls -la /opt/data-sync/

# Check status
sudo systemctl list-timers oracle-clickhouse-sync

# View logs
sudo journalctl -u oracle-clickhouse-sync -f
```

---

## 📝 File Structure sau deploy

```
clone-data-src/
├── sync_oracle_to_clickhouse.py
├── setup_daily_sync.sh
├── test_sync_connection.sh
├── deploy_to_linux.ps1          ← PowerShell script
├── deploy_to_linux.bat          ← Batch script
├── DEPLOY_GUIDE_WINDOWS.md      ← This file
└── DEPLOY_GUIDE.md              ← Linux version
```

---

## 🚀 Command Reference

| Action         | PowerShell                         | CMD                                |
| -------------- | ---------------------------------- | ---------------------------------- |
| Copy 1 file    | `scp file.txt user@host:/path/`    | `scp file.txt user@host:/path/`    |
| Copy multiple  | `scp file1 file2 user@host:/path/` | `scp file1 file2 user@host:/path/` |
| Copy folder    | `scp -r folder user@host:/path/`   | `scp -r folder user@host:/path/`   |
| SSH            | `ssh user@host`                    | `ssh user@host`                    |
| Remote command | `ssh user@host "command"`          | `ssh user@host "command"`          |

---

## 💡 Tips

1. **Lần đầu**: Script sẽ copy tất cả records từ Oracle
2. **Lần sau**: Chỉ copy records mới (incremental)
3. **No new data**: Skip update (không làm gì)
4. **Check logs**: `tail -f /opt/data-sync/logs/sync_*.log`

---

## Next Step

Sau khi deploy thành công, bạn sẽ có:

- ✅ Files trên server
- ✅ Virtual environment
- ✅ Systemd timer (chạy 2 AM hàng ngày)
- ✅ Logs được ghi vào file

**Monitor từ Windows:**

```powershell
# Watch logs real-time
ssh admin@192.168.1.100 "tail -f /opt/data-sync/logs/sync_*.log"

# Check next run time
ssh admin@192.168.1.100 "sudo systemctl list-timers oracle-clickhouse-sync"
```
