**Folder**

Choose a local directory containing the data files you want to browse. Use **Browse** to open the folder picker, or paste an absolute directory path.

Enable recursive scanning to include files in subfolders. Use the optional file pattern in Advanced settings to limit the files, for example `*.csv`.

**Files**

CSV, TSV, Parquet, JSON, and JSONL can be imported as tables. Excel workbooks (`.xlsx` or `.xls`), Markdown, PDFs, and other files are listed as file artifacts.

Select a file to preview it without importing it. Excel workbooks open in a read-only workbook viewer with sheet tabs, cell positions, merged cells, and formatting, without treating the first row as column headers. Preview fidelity depends on the workbook features supported by the renderer.

Choose **Load file** to copy a file into the workspace and open it in the same file viewer. The original file is unchanged. Previews are limited to 20 MB; unsupported preview formats can still be downloaded after import. File imports are limited to 128 MB.

Hidden files and paths outside the connected directory are excluded. Local-folder connections are available only in local deployment mode.
