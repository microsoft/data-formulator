# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# ---------------------------------------------------------------------------
# Stage 1: Build the React/TypeScript frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder

WORKDIR /app

# Install system dependencies required to compile native modules (e.g. canvas).
# node:20-slim lacks the build toolchain and Cairo development headers that
# node-gyp needs when building the "canvas" package during yarn install.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ pkg-config \
        libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Raise the Node.js heap limit to avoid "JavaScript heap out of memory"
# failures during the Vite production build. Node defaults to ~2 GB regardless
# of the memory allocated to Docker. Override with --build-arg NODE_HEAP_MB=...
ARG NODE_HEAP_MB=8192
ENV NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_MB}

# Copy source and build
COPY index.html tsconfig.json vite.config.ts eslint.config.js ./
COPY public ./public
COPY src ./src
RUN yarn build

# ---------------------------------------------------------------------------
# Stage 2: Python runtime with the built frontend bundled in
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

# System dependencies needed by some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libpq-dev \
        unixodbc-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the application
RUN useradd -m -s /bin/bash appuser

# Ensure Unicode filenames work correctly (Chinese, Japanese, etc.)
ENV LANG=C.UTF-8

# Set the home directory for workspace data to a deterministic path
ENV DATA_FORMULATOR_HOME=/home/appuser/.data_formulator

WORKDIR /app

# Copy Python package sources
COPY pyproject.toml MANIFEST.in README.md ./
COPY py-src ./py-src

# Copy the compiled frontend into the package's expected location
COPY --from=frontend-builder /app/py-src/data_formulator/dist ./py-src/data_formulator/dist

# Install the package and its dependencies
RUN pip install --no-cache-dir .

# Switch to non-root user and ensure workspace and app directories are owned by it
RUN mkdir -p "${DATA_FORMULATOR_HOME}" && chown -R appuser:appuser /app "${DATA_FORMULATOR_HOME}"
USER appuser

EXPOSE 5567

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:5567/ || exit 1

# Run the app on all interfaces so Docker port-forwarding works.
# We do not pass --dev so Flask runs in production mode (no debugger/reloader).
# webbrowser.open() fails silently in a headless container, which is harmless.
ENTRYPOINT ["python", "-m", "data_formulator", "--host", "0.0.0.0", "--port", "5567"]
