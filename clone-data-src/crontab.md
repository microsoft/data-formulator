#Xóa crontab cũ:
crontab -r
Thêm crontab mới với venv:
crontab -r
(crontab -l 2>/dev/null; echo "_/15 _ \* \* _ cd /home/administrator/Documents/Docker/data-sync/clone-data-src && source venv/bin/activate && python3 sync-once.py >> /var/log/sync.log 2>&1"; echo "_/30 \* \* \* \* cd /home/administrator/Documents/Docker/data-sync/clone-data-src && source venv/bin/activate && python3 sync-once-with-cleanup.py >> /var/log/sync-cleanup.log 2>&1") | crontab -

Kiểm tra:
crontab -l

# Tạo virtual env (lần đầu)

python3 -m venv venv

# Kích hoạt

source venv/bin/activate

# Cài dependencies

pip install -r requirements-sync.txt

# Test chạy

# Xem logs

tail -f /var/log/sync.log
python3 sync-once-with-cleanup.py

# Xem logs thực tế

tail -f /var/log/sync-cleanup.log

# Hoặc xem 100 dòng gần nhất

tail -100 /var/log/sync-cleanup.log

# Xem cron logs

sudo journalctl -u cron -f

# Hoặc

sudo tail -f /var/log/syslog | grep CRON

 <!-- crontab -l 2>/dev/null; echo "*/15 * * * * cd /home/administrator/Documents/Docker/data-sync/clone-data-src && source venv/bin/activate && python3 sync-once.py >> /var/log/sync.log 2>&1" | crontab -


 (crontab -l 2>/dev/null; echo "*/1 * * * * cd /home/administrator/Documents/Docker/data-sync/clone-data-src && source venv/bin/activate && python3 sync-once.py >> /var/log/sync.log 2>&1"; echo "*/30 * * * * cd /home/administrator/Documents/Docker/data-sync/clone-data-src && source venv/bin/activate && python3 sync-once-with-cleanup.py >> /var/log/sync-cleanup.log 2>&1") | crontab - -->
