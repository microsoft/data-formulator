# Use a multi-stage build to reduce final image size

# Stage 1: Build the frontend
FROM node:18 AS frontend-builder

WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker cache
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy the rest of the frontend code
COPY . .

# Build the frontend
RUN yarn build

# Stage 2: Build the backend and create the final image
FROM python:3.12-slim

WORKDIR /app

# Copy built frontend from the previous stage
COPY --from=frontend-builder /app/py-src/data_formulator/dist /app/py-src/data_formulator/dist

# Copy backend code
COPY py-src /app/py-src
COPY requirements.txt /app/
COPY pyproject.toml /app/
COPY README.md /app/
COPY LICENSE /app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entrypoint script
COPY docker-entrypoint.sh /app/

# Make the entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Expose the port the app runs on
EXPOSE 5000

# Set the entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]