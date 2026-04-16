# PostgreSQL Test Database for Data Formulator
FROM postgres:16-alpine

ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=postgres
ENV POSTGRES_DB=testdb

COPY init.sql /docker-entrypoint-initdb.d/
EXPOSE 5432
