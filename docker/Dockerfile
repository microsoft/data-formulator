# Use Python slim image for smaller size
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install data_formulator
RUN pip install --no-cache-dir data_formulator

# Create directory for API keys
RUN mkdir -p /app/config

# Copy entrypoint script
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Expose default port
EXPOSE 5000

# Set environment variables
ENV PORT=5000
ENV CONFIG_DIR=/app/config

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
