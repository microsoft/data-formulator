from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.kusto_data_loader import KustoDataLoader

DATA_LOADERS = {
    "mysql": MySQLDataLoader,
    "kusto": KustoDataLoader
}

__all__ = ["ExternalDataLoader", "MySQLDataLoader", "KustoDataLoader", "DATA_LOADERS"]