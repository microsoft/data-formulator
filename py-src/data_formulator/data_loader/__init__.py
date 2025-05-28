from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
from data_formulator.data_loader.s3_data_loader import S3DataLoader

DATA_LOADERS = {
    "mysql": MySQLDataLoader,
    "kusto": KustoDataLoader,
    "s3": S3DataLoader,
}

__all__ = ["ExternalDataLoader", "MySQLDataLoader", "KustoDataLoader", "S3DataLoader", "DATA_LOADERS"]
