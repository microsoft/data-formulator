from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
from data_formulator.data_loader.s3_data_loader import S3DataLoader
from data_formulator.data_loader.azure_blob_data_loader import AzureBlobDataLoader
from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader
from data_formulator.data_loader.clickhouse_data_loader import ClickHouseDataLoader
from data_formulator.data_loader.snowflake_data_loader import SnowflakeDataLoader
from data_formulator.data_loader.supabase_data_loader import SupabaseDataLoader
from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader
from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader

DATA_LOADERS = {
    "mysql": MySQLDataLoader,
    "mssql": MSSQLDataLoader,
    "kusto": KustoDataLoader,
    "s3": S3DataLoader,
    "azure_blob": AzureBlobDataLoader,
    "postgresql": PostgreSQLDataLoader,
    "clickhouse": ClickHouseDataLoader,
    "snowflake": SnowflakeDataLoader,
    "supabase": SupabaseDataLoader,
    "bigquery": BigQueryDataLoader,
    "mongodb": MongoDBDataLoader
}

__all__ = ["ExternalDataLoader", "MySQLDataLoader", "MSSQLDataLoader", "KustoDataLoader", "S3DataLoader", "AzureBlobDataLoader","PostgreSQLDataLoader", "ClickHouseDataLoader", "SnowflakeDataLoader", "SupabaseDataLoader", "BigQueryDataLoader", "MongoDBDataLoader", "DATA_LOADERS"]
