# MongoDB Test Database for Data Formulator
FROM mongo:7-jammy

ENV MONGO_INITDB_ROOT_USERNAME=admin
ENV MONGO_INITDB_ROOT_PASSWORD=admin
ENV MONGO_INITDB_DATABASE=testdb

COPY init_data.js /docker-entrypoint-initdb.d/
EXPOSE 27017
