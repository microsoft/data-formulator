import os

from data_formulator.auth.azure_cli import expose_azure_cli


def test_expose_azure_cli_adds_executable_directory_to_path(monkeypatch, tmp_path):
    executable = tmp_path / "az"
    executable.touch()
    monkeypatch.setattr(
        "data_formulator.auth.azure_cli.shutil.which",
        lambda _: str(executable),
    )
    monkeypatch.setenv("PATH", "/usr/bin")

    assert expose_azure_cli() == str(executable)
    assert os.environ["PATH"].split(os.pathsep)[0] == str(tmp_path)