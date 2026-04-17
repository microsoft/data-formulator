# Cosmos DB Emulator for Data Formulator Tests
#
# NOTE: This Dockerfile is no longer used — docker-compose.yml pulls the
# emulator image directly. Kept for reference only.
#
# The emulator only supports x86_64. On Apple Silicon, docker-compose.yml
# sets `platform: linux/amd64` to run under Rosetta.

FROM --platform=linux/amd64 mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:latest

EXPOSE 8081
EXPOSE 10250-10255
