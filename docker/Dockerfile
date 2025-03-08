# Stage 1: Development environment
FROM python:3.12-slim as development

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js and yarn
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn

# Set working directory
WORKDIR /app

# Create directory for API keys
RUN mkdir -p /app/config

# Copy entrypoint script
COPY docker/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Install Python dependencies
COPY requirements.txt .
# Remove the "-e ." line from requirements.txt before installing
RUN sed -i '/-e \./d' requirements.txt && \
    pip install --no-cache-dir -r requirements.txt

# Install Node.js dependencies
COPY package.json yarn.lock ./
RUN yarn install

# Copy source code
COPY . .

# Expose ports for both backend and frontend development
EXPOSE 5000 5173

# Set environment variables
ENV PORT=5000
ENV CONFIG_DIR=/app/config
ENV NODE_ENV=development

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Stage 2: Production environment
FROM python:3.12-slim as production

# Set working directory
WORKDIR /app

# Create directory for API keys
RUN mkdir -p /app/config

# Copy entrypoint script
COPY docker/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Install data_formulator package
RUN pip install --no-cache-dir data_formulator

# Expose backend port
EXPOSE 5000

# Set environment variables
ENV PORT=5000
ENV CONFIG_DIR=/app/config
ENV NODE_ENV=production

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
