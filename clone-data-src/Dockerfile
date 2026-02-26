# Sử dụng Python 3.11 slim image từ Docker Hub
FROM python:3.11-slim

# Đặt thư mục làm việc
WORKDIR /app

# Cài đặt các gói hệ thống cần thiết
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements-sync.txt .

# Cài đặt Python dependencies
RUN pip install --no-cache-dir -r requirements-sync.txt

# Copy chương trình sync
COPY sync-code.py .

# Copy .env file nếu có (tuỳ chọn)
# COPY .env .env

# Lệnh chạy chương trình
CMD ["python", "sync-code.py"]
