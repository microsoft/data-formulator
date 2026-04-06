# MySQL Test Database for Data Formulator
FROM mysql:8.0

ENV MYSQL_ROOT_PASSWORD=mysql
ENV MYSQL_DATABASE=testdb

COPY init.sql /docker-entrypoint-initdb.d/
EXPOSE 3306
