# BigQuery Emulator Test Environment for Data Formulator
# Uses goccy/bigquery-emulator for local BigQuery testing

FROM ghcr.io/goccy/bigquery-emulator:latest

# Copy initialization data
COPY init_data.yaml /init_data.yaml

# Expose BigQuery emulator ports
# 9050 - HTTP/REST port
# 9060 - gRPC port
EXPOSE 9050 9060

# Run the emulator with initialization data
ENTRYPOINT ["bigquery-emulator", "--project=test-project", "--data-from-yaml=/init_data.yaml"]
