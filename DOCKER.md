# Docker Setup and Deployment

This document provides detailed instructions on setting up and deploying Data Formulator using Docker.

## Prerequisites

*   Docker installed and running on your system. You can download Docker from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop).
*   Docker Compose installed.  Docker Desktop includes Docker Compose.  If you're not using Docker Desktop, follow the instructions at [https://docs.docker.com/compose/install/](https://docs.docker.com/compose/install/).

## Building the Docker Image

The `Dockerfile` contains instructions for building a Docker image that includes both the frontend and backend of Data Formulator.  It uses a multi-stage build process to minimize the final image size.

To build the image, run the following command from the root directory of the project:

```bash
docker build -t data-formulator .
```

## Running the Docker Container

To run the container, run the following command from the root directory of the project:

```bash
docker run -p 5000:5000 data-formulator
```

This will create a Docker image named `data-formulator`.

## Running Data Formulator with Docker

### Using `docker run`

You can run Data Formulator directly using the `docker run` command.  This is useful for quick testing or simple deployments.

```bash

docker run -p 5000:5000 -e OPENAI_API_KEY=your-openai-key -e AZURE_API_KEY=your-azure-key ... data-formulator
```

*   `-p 5000:5000`: This maps port 5000 on your host machine to port 5000 inside the container.  Data Formulator runs on port 5000 by default.
*   `-e VAR=value`: This sets environment variables inside the container.  You **must** provide your API keys and other configuration settings using environment variables.  See the [Configuration](#configuration) section in `README.md` for a complete list of supported environment variables.  Replace placeholders like `your-openai-key` with your actual API keys.
*   `data-formulator`: This is the name of the Docker image you built earlier.

### Using Docker Compose (Recommended)

Docker Compose simplifies the process of running multi-container applications.  Data Formulator, while technically a single service, benefits from Docker Compose for managing environment variables and simplifying the startup process.

The `docker-compose.yml` file defines the Data Formulator service.  Here's a breakdown:

```yaml

version: '3.8'

services:
  data-formulator:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    environment:
      - FLASK_APP=py-src/data_formulator/app.py
      - FLASK_RUN_PORT=5000
      - FLASK_RUN_HOST=0.0.0.0
#Add your API keys here as environment variables, e.g.:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - AZURE_API_KEY=${AZURE_API_KEY}
      - AZURE_API_BASE=${AZURE_API_BASE}
      - AZURE_API_VERSION=${AZURE_API_VERSION}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OLLAMA_API_BASE=${OLLAMA_API_BASE}
volumes:
      - .:/app # Mount the current directory for development
```

*   `version: '3.8'`: Specifies the Docker Compose file version.
*   `services: data-formulator:`: Defines a service named `data-formulator`.
*   `build:`: Specifies how to build the image.
    *   `context: .`:  Uses the current directory as the build context.
    *   `dockerfile: Dockerfile`: Uses the `Dockerfile` in the current directory.
*   `ports: - "5000:5000"`: Maps port 5000 on the host to port 5000 in the container.
*   `environment:`: Sets environment variables inside the container.  This is where you should put your API keys.  You can either hardcode them here (not recommended for production) or use variable substitution from your shell environment (e.g., `- OPENAI_API_KEY=${OPENAI_API_KEY}`).
*  `volumes: - .:/app`: This line mounts the project root directory to `/app` inside the container. This is very useful during development, as any changes you make to your code will be immediately reflected inside the running container without needing to rebuild the image.  **For production deployments, you should remove or comment out this line.**

To run Data Formulator using Docker Compose:

1.  **Set your API keys as environment variables in your shell:**

    ```bash
    export OPENAI_API_KEY=your-openai-key
    export AZURE_API_KEY=your-azure-key
    # ... set other API keys as needed
    ```

    Or, create a `.env` file in the project root directory and add your API keys there:

    ```
    OPENAI_API_KEY=your-openai-key
    AZURE_API_KEY=your-azure-key
    # ... other API keys
    ```
    Docker Compose will automatically read environment variables from a `.env` file in the same directory as the `docker-compose.yml` file.  **Do not commit your `.env` file to version control.**  It's included in the `.gitignore` file.

2.  **Run Docker Compose:**

    ```bash
    docker-compose up --build
    ```

    *   `up`: Starts the services defined in `docker-compose.yml`.
    *   `--build`:  Forces a rebuild of the image, even if one already exists.  Use this if you've made changes to the `Dockerfile` or your application code.

    The first time you run this, Docker will download the necessary base images and build the Data Formulator image.  Subsequent runs will be faster, especially if you use the volume mount for development.

3.  **Access Data Formulator:**

    Open your web browser and go to `http://localhost:5000`.

## Stopping Data Formulator

To stop the Data Formulator container(s) when running with Docker Compose, press `Ctrl+C` in the terminal where `docker-compose up` is running.  You can also run:


