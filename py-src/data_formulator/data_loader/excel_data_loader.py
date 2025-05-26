from .external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Dict, Any, List
import pandas as pd
import duckdb # Will be provided by Data Formulator core
import json # Make sure json is imported

class ExcelDataLoader(ExternalDataLoader):
    @staticmethod
    def list_params() -> List[Dict[str, Any]]:
        return [
            {
                "name": "file_path",
                "type": "string",
                "required": True,
                "description": "Path to the Excel file (e.g., /path/to/your/file.xlsx)",
            }
        ]

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.file_path = params.get("file_path")
        if not self.file_path:
            raise ValueError("Missing required parameter: file_path")
        
        self.duck_db_conn = duck_db_conn # Store the duckdb connection
        
        try:
            # Make sure to install openpyxl: pip install openpyxl
            self.excel_file = pd.ExcelFile(self.file_path, engine='openpyxl')
        except FileNotFoundError:
            # More specific error for user
            raise ValueError(f"Excel file not found at path: {self.file_path}. Please ensure the path is correct and the file exists.")
        except Exception as e:
            # Catch other pandas/openpyxl exceptions, e.g., if the file is not a valid Excel file
            raise ValueError(f"Error opening or parsing Excel file at {self.file_path}. Ensure it's a valid Excel file. Error: {e}")

    def list_tables(self) -> List[Dict[str, Any]]:
        sheet_details = []
        if not self.excel_file:
            raise ValueError("Excel file is not loaded. Cannot list sheets.")

        sheet_names = self.excel_file.sheet_names
        
        for sheet_name in sheet_names:
            try:
                # Read a small sample to get header and types, limit rows to avoid loading large sheets
                # Reading just the first row for columns, then first 5 for sample data
                df_sample = pd.read_excel(self.excel_file, sheet_name=sheet_name, nrows=5)
                
                if df_sample.empty:
                    column_names = []
                    column_types = []
                    sample_rows = []
                else:
                    column_names = df_sample.columns.tolist()
                    column_types = [str(dtype) for dtype in df_sample.dtypes.tolist()] # Convert dtypes to string representations
                    
                    # Prepare sample data (list of lists)
                    sample_rows = df_sample.head(5).values.tolist()

                sheet_details.append({
                    "table_name": sheet_name,
                    "column_names": column_names,
                    "column_types": column_types,
                    "sample_data": sample_rows, # Sample data as a list of rows
                })
            except Exception as e:
                # If a sheet cannot be read, we can skip it or log an error
                # For now, let's print a warning and skip it
                print(f"Warning: Could not read sheet '{sheet_name}'. Error: {e}")
                sheet_details.append({
                    "table_name": sheet_name,
                    "column_names": [],
                    "column_types": [],
                    "sample_data": [],
                    "error": f"Could not read sheet: {e}"
                })
        return sheet_details

    def ingest_data(self, table_name: str, name_as: str = None, size: int = None): # Allow size to be None for full sheet
        if not self.excel_file:
            raise ValueError("Excel file is not loaded. Cannot ingest data.")

        if table_name not in self.excel_file.sheet_names:
            raise ValueError(f"Sheet '{table_name}' not found in the Excel file.")

        final_table_name = sanitize_table_name(name_as if name_as else table_name)

        try:
            # Determine number of rows to read
            nrows_to_read = size if size is not None and size > 0 else None

            df = pd.read_excel(self.excel_file, sheet_name=table_name, nrows=nrows_to_read)
            
            if df.empty and table_name in self.excel_file.sheet_names:
                # If df is empty but sheet exists, could be an empty sheet or only header
                # Try to get columns if df is empty but sheet exists
                # This case might be handled by how ingest_df_to_duckdb handles empty dataframes.
                # For now, we pass it as is.
                print(f"Warning: Sheet '{table_name}' is empty or contains only headers.")


            # Use the inherited method to ingest the DataFrame into DuckDB
            self.ingest_df_to_duckdb(df, final_table_name)
            
            print(f"Successfully ingested sheet '{table_name}' as table '{final_table_name}' into DuckDB.")
            # Return information about the ingested table, like its name and number of rows
            # This structure might need to align with what the frontend/caller expects.
            # For now, returning a simple success message or dict.
            return {
                "status": "success",
                "message": f"Sheet '{table_name}' ingested as '{final_table_name}'.",
                "table_name": final_table_name,
                "rows_ingested": len(df)
            }

        except Exception as e:
            raise RuntimeError(f"Error ingesting sheet '{table_name}': {e}")

    def view_query_sample(self, query: str) -> str: # query here will be the sheet name
        if not self.excel_file:
            raise ValueError("Excel file is not loaded. Cannot view sample.")

        sheet_name = query # Assuming 'query' is the sheet name for Excel files
        
        if sheet_name not in self.excel_file.sheet_names:
            # Check if it's a table name that might exist in DuckDB (e.g., after ingestion)
            # However, this method is about previewing from the *source* (Excel)
            # So, if the sheet_name isn't in the Excel file, it's an error for this method's intent.
            raise ValueError(f"Sheet '{sheet_name}' not found in the Excel file.")

        try:
            df_sample = pd.read_excel(self.excel_file, sheet_name=sheet_name, nrows=5)
            # Convert dataframe sample to JSON string
            return df_sample.to_json(orient="records", indent=4)
        except Exception as e:
            # Handle cases where sheet might exist but can't be read, or other pandas errors
            raise RuntimeError(f"Error reading sample from sheet '{sheet_name}': {e}")

    def ingest_data_from_query(self, query: str, name_as: str):
        # This method is not typically applicable to Excel files which are not queryable databases.
        # The primary way to ingest data is by sheet name using ingest_data.
        raise NotImplementedError("Ingesting data from a query is not supported for Excel files. Please use 'ingest_data' by sheet name.")
