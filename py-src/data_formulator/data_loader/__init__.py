from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
from data_formulator.data_loader.excel_data_loader import ExcelDataLoader # Added import

DATA_LOADERS = {
    "mysql": MySQLDataLoader,
    "kusto": KustoDataLoader,
    "excel": ExcelDataLoader  # Added ExcelDataLoader
}

__all__ = ["ExternalDataLoader", "MySQLDataLoader", "KustoDataLoader", "ExcelDataLoader", "DATA_LOADERS"] # Added ExcelDataLoader to __all__