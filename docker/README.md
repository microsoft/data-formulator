# Docker Support for Data Formulator

This directory contains Docker configuration for running Data Formulator in a containerized environment.

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/microsoft/data-formulator.git
cd data-formulator/docker
```

2. Configure your API keys:
   - Create a `config/api-keys.env` file with your API keys:
   ```env
   OPENAI_API_KEY=your_openai_key
   AZURE_API_KEY=your_azure_key
   ANTHROPIC_API_KEY=your_anthropic_key
   ```
   Or set them directly in `docker-compose.yml`

3. Build and run using Docker Compose:
```bash
docker compose up -d
```

4. Access Data Formulator at http://localhost:5000

## Configuration

### Environment Variables

- `PORT`: The port to run Data Formulator on (default: 5000)
- `OPENAI_API_KEY`: Your OpenAI API key
- `AZURE_API_KEY`: Your Azure API key
- `ANTHROPIC_API_KEY`: Your Anthropic API key

### Docker Compose

The included `docker-compose.yml` provides a ready-to-use configuration:
- Maps port 5000 to the host
- Mounts a local config directory for API keys
- Configures automatic restart

### Custom Port

To use a different port:

1. Update the port in `docker-compose.yml`:
```yaml
ports:
  - "8080:5000"  # Change 8080 to your desired port
```

2. Or use environment variable:
```bash
PORT=8080 docker compose up -d
```

## Development

To build the image manually:
```bash
docker build -t data-formulator .
```

To run without Docker Compose:
```bash
docker run -p 5000:5000 -v ./config:/app/config data-formulator
```

## Troubleshooting

1. If you see permission errors:
   - Ensure the config directory exists and has proper permissions
   - Check that api-keys.env is readable

2. If the container exits immediately:
   - Check the logs: `docker compose logs`
   - Verify your API keys are properly configured

3. If you can't connect:
   - Verify the port mapping in docker-compose.yml
   - Check if another service is using port 5000
