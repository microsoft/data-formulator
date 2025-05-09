# Docker Support for Data Formulator

This directory contains Docker configuration for running Data Formulator in both development and production environments.

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/microsoft/data-formulator.git
cd data-formulator
```

2. Configure your API keys:
   - Copy the template: `cp docker/config/api-keys.env.template docker/config/api-keys.env`
   - Edit `docker/config/api-keys.env` with your API keys:
   ```env
   OPENAI_API_KEY=your_openai_key
   AZURE_API_KEY=your_azure_key
   ANTHROPIC_API_KEY=your_anthropic_key
   ```

## Development Mode

Development mode provides hot-reloading for both frontend and backend changes.

1. Start the development environment:
```bash
docker compose -f docker/docker-compose.yml up data-formulator-dev
```

2. Access the development servers:
   - Frontend: http://localhost:5173 (with hot-reloading)
   - Backend API: http://localhost:5001 (mapped to internal port 5000)

3. Development Features:
   - Live reload on frontend changes
   - Source code mounted from host
   - Node modules persisted in Docker volume
   - Both frontend and backend servers running in the same container
   - The frontend Vite server runs on port 5173
   - The backend Flask server runs on port 5001 (mapped from internal port 5000)

## Production Mode

Production mode runs the optimized build for deployment.

1. Start the production environment:
```bash
docker compose -f docker/docker-compose.yml up data-formulator
```

2. Access Data Formulator at http://localhost:5000

## Configuration

### Environment Variables

- `PORT`: The port to run Data Formulator on (default: 5000)
- `NODE_ENV`: Environment mode ('development' or 'production')
- `OPENAI_API_KEY`: Your OpenAI API key
- `AZURE_API_KEY`: Your Azure API key
- `ANTHROPIC_API_KEY`: Your Anthropic API key

### Custom Port Configuration

1. Update ports in docker-compose.yml:
```yaml
ports:
  - "8080:5000"  # For production
  # For development:
  - "8080:5000"  # Backend
  - "5173:5173"  # Frontend dev server
```

2. Or use environment variable:
```bash
PORT=8080 docker compose -f docker/docker-compose.yml up data-formulator
```

## Building

### Development Build
```bash
docker compose -f docker/docker-compose.yml build data-formulator-dev
```

### Production Build
```bash
docker compose -f docker/docker-compose.yml build data-formulator
```

## Testing

1. Run tests in development container:
```bash
docker compose -f docker/docker-compose.yml run --rm data-formulator-dev yarn test
```

## Troubleshooting

1. Permission Issues:
   - Ensure the config directory exists: `mkdir -p docker/config`
   - Set proper permissions: `chmod 644 docker/config/api-keys.env`

2. Container Startup Issues:
   - Check logs: `docker compose -f docker/docker-compose.yml logs`
   - Verify API keys in docker/config/api-keys.env
   - Ensure no conflicting services on ports 5000 or 5173

3. Development Mode Issues:
   - Clear node_modules volume: `docker compose -f docker/docker-compose.yml down -v`
   - Rebuild development container: `docker compose -f docker/docker-compose.yml build --no-cache data-formulator-dev`

4. Hot Reload Not Working:
   - Ensure proper volume mounts in docker-compose.yml
   - Check frontend console for errors
   - Verify file permissions on mounted directories

5. Backend and Frontend Connection Issues:
   - The frontend is accessible at http://localhost:5173
   - The backend API is accessible at http://localhost:5001
   - If you can access the frontend but not the backend, ensure both services are running in the container
   - Check that the PYTHONPATH is correctly set to include the py-src directory

## Contributing

When contributing Docker-related changes:
1. Test both development and production builds
2. Verify hot-reloading functionality
3. Update documentation for any new features or changes
4. Follow the project's coding standards
