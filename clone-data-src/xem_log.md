# Xem log file crontab ghi (sync.log chứ không phải sync-cleanup.log)

tail -50 /var/log/sync.log

# Xem có lỗi gì không

grep -i error /var/log/sync.log | tail -10

# Xem lần chạy gần nhất

grep "Starting from seq" /var/log/sync.log | tail -3
grep "Synced" /var/log/sync.log | tail -3

# Cron process có chạy không

ps aux | grep -E 'cron|sync-once'

# Xem cron logs

sudo journalctl -u cron -n 20

# hoặc

sudo tail -50 /var/log/cron # Nếu có file này

# Kiểm tra crontab user

whoami
crontab -l

# Kiểm tra quyền thư mục

ls -la /home/administrator/Documents/Docker/data-sync/clone-data-src/

# Chạy command cron thử

cd /home/administrator/Documents/Docker/data-sync/clone-data-src && \
source venv/bin/activate && \
python3 sync-once.py >> /var/log/sync.log 2>&1

# Xem kết quả

tail -20 /var/log/sync.log

sudo systemctl restart cron

# hoặc

sudo systemctl restart crond
