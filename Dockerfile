# Dockerfile for Python backend (data-formulator)
FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY py-src/ ./py-src/
COPY api-keys.env ./

# Expose port (tuỳ chỉnh nếu backend chạy port khác)
EXPOSE 8000

# Command to run backend (giả sử dùng uvicorn, sửa lại nếu khác)
CMD ["python", "-m", "data_formulator"]
