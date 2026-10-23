**Folder**

Choose a local directory containing the data files you want to browse. Use **Browse** to open the folder picker, or paste an absolute directory path.

Enable recursive scanning to include files in subfolders. Use the optional file pattern in Advanced settings to limit the files, for example `*.csv`.

**Files**

CSV, TSV, Parquet, JSON, and JSONL can be imported as tables. Excel workbooks (`.xlsx` or `.xls`), Markdown, PDFs, and other files are listed as file artifacts.

CSV, TSV, Parquet, JSON, and JSONL table queries use DuckDB's native readers
within the connected directory and return Arrow tables.
Filters, sorting, and column selection are applied before the result limit.
Aggregates operate on the source rather than a capped preview. Text schemas
are inferred by DuckDB and can differ from previous Arrow types. Schema
detection and buffering can read beyond the requested preview; text files do
not offer Parquet's row-group pruning. Text preview totals remain unknown
without a separate count. Excel is a file artifact and is rejected by table
preview/import methods.

Text-file listings use file metadata only. Explicit inspection reuses a bounded
sample for inferred schema and examples; Parquet inspection reads only its footer.
UI table previews return up to 50 rows and 20 columns, while agents receive up to
five rows with shorter values. Omitted columns, inferred schemas, and shortened
values are identified in the inspection result.

Select a file to preview it without importing it. Excel workbooks open in a read-only workbook viewer with sheet tabs, cell positions, merged cells, and formatting, without treating the first row as column headers. Preview fidelity depends on the workbook features supported by the renderer.

Choose **Load file** to copy a file into the workspace and open it in the same file viewer. The original file is unchanged. Previews are limited to 20 MB; unsupported preview formats can still be downloaded after import. File imports are limited to 128 MB.

Hidden files and paths outside the connected directory are excluded. Local-folder connections are available only in local deployment mode.
