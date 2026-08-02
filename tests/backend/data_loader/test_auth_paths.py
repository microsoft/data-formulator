from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader


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