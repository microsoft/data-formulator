import pyarrow as pa

from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader


def test_mysql_declares_password_auth_path() -> None:
    assert MySQLDataLoader.auth_paths() == [{
        "id": "password",
        "label": "Username and password",
        "description": "Connect with a MySQL user. Password may be blank.",
        "fields": ["user", "password"],
        "required_fields": ["user"],
        "kind": "credentials",
        "default": True,
    }]


def test_mysql_validation_materializes_defaults() -> None:
    params: dict = {}

    MySQLDataLoader.validate_params(params)

    assert params["host"] == "localhost"
    assert params["port"] == 3306
    assert params["user"] == "root"
    assert params["_auth_path"] == "password"


def test_mssql_sorted_fetch_places_order_by_after_top() -> None:
    loader = MSSQLDataLoader.__new__(MSSQLDataLoader)
    loader._safe_select_list = lambda schema, table: "*"
    queries: list[str] = []
    loader._execute_query = lambda query: queries.append(query) or pa.table({})

    result = loader.fetch_data_as_arrow(
        "dbo.products",
        {"size": 5, "sort_columns": ["price"], "sort_order": "desc"},
    )

    assert result.num_rows == 0
    assert queries == ["SELECT TOP 5 * FROM [dbo].[products] ORDER BY [price] DESC"]