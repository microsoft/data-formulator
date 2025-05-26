import unittest
import pandas as pd
import duckdb
import os
import json
import tempfile
from data_formulator.data_loader.excel_data_loader import ExcelDataLoader
from data_formulator.data_loader.external_data_loader import sanitize_table_name
import pandas.testing as pd_testing

class TestExcelDataLoader(unittest.TestCase):
    def setUp(self):
        # Initialize DuckDB connection
        self.db_conn = duckdb.connect(':memory:')

        # Create sample data
        self.sheet1_name = 'Sheet1_Data'
        self.sheet1_data = pd.DataFrame({
            'ID': [1, 2, 3],
            'Name': ['Alice', 'Bob', 'Charlie'],
            'Value': [100, 200, 300]
        })

        self.sheet2_name = 'Another_Sheet'
        self.sheet2_data = pd.DataFrame({
            'Category': ['X', 'Y', 'X', 'Z'],
            'Data1': [10.1, 20.2, 30.3, 40.4],
            'Data2': ['text1', 'text2', 'text3', 'text4']
        })
        
        # Create a temporary Excel file
        # delete=False is important because we need to close it before ExcelDataLoader can open it
        # and then delete it manually in tearDown.
        temp_file = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        self.excel_file_path = temp_file.name
        temp_file.close() # Close the file handle so pandas can write to it

        try:
            with pd.ExcelWriter(self.excel_file_path, engine='openpyxl') as writer:
                self.sheet1_data.to_excel(writer, sheet_name=self.sheet1_name, index=False)
                self.sheet2_data.to_excel(writer, sheet_name=self.sheet2_name, index=False)
        except Exception as e:
            # If setup fails, try to clean up the temp file if it was created
            if os.path.exists(self.excel_file_path):
                os.remove(self.excel_file_path)
            raise e


    def tearDown(self):
        # Close DuckDB connection
        if hasattr(self, 'db_conn') and self.db_conn:
            self.db_conn.close()
        
        # Delete the temporary Excel file
        if hasattr(self, 'excel_file_path') and os.path.exists(self.excel_file_path):
            os.remove(self.excel_file_path)

    # Test cases will be added here
    def test_list_params(self):
        params = ExcelDataLoader.list_params()
        self.assertEqual(len(params), 1)
        param = params[0]
        self.assertEqual(param["name"], "file_path")
        self.assertEqual(param["type"], "string")
        self.assertTrue(param["required"])
        self.assertIn("Path to the Excel file", param["description"])

    def test_init_success(self):
        try:
            loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
            self.assertIsNotNone(loader.excel_file) # Check if excel_file attribute is populated
            self.assertEqual(loader.file_path, self.excel_file_path)
        except Exception as e:
            self.fail(f"ExcelDataLoader initialization failed: {e}")

    def test_init_file_not_found(self):
        with self.assertRaisesRegex(ValueError, "Excel file not found at path: non_existent_file.xlsx"):
            ExcelDataLoader(params={"file_path": "non_existent_file.xlsx"}, duck_db_conn=self.db_conn)

    def test_list_tables(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
        tables = loader.list_tables()

        self.assertEqual(len(tables), 2) # Expecting two sheets

        # Verify Sheet1_Data
        sheet1_info = next((t for t in tables if t["table_name"] == self.sheet1_name), None)
        self.assertIsNotNone(sheet1_info)
        self.assertListEqual(sheet1_info["column_names"], self.sheet1_data.columns.tolist())
        # Pandas dtypes are specific, for simplicity in test, we might just check if they are strings
        self.assertEqual(len(sheet1_info["column_types"]), len(self.sheet1_data.columns))
        self.assertEqual(len(sheet1_info["sample_data"]), 3) # 3 rows of sample data
        self.assertListEqual(sheet1_info["sample_data"][0], self.sheet1_data.iloc[0].tolist())

        # Verify Another_Sheet
        sheet2_info = next((t for t in tables if t["table_name"] == self.sheet2_name), None)
        self.assertIsNotNone(sheet2_info)
        self.assertListEqual(sheet2_info["column_names"], self.sheet2_data.columns.tolist())
        self.assertEqual(len(sheet2_info["column_types"]), len(self.sheet2_data.columns))
        self.assertEqual(len(sheet2_info["sample_data"]), 4) # 4 rows of sample data
        self.assertListEqual(sheet2_info["sample_data"][0], self.sheet2_data.iloc[0].tolist())

    def test_ingest_data_success(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)

        # Test ingesting Sheet1_Data with its original name
        ingest_result1 = loader.ingest_data(table_name=self.sheet1_name)
        expected_table_name1 = sanitize_table_name(self.sheet1_name)
        
        self.assertEqual(ingest_result1["status"], "success")
        self.assertEqual(ingest_result1["table_name"], expected_table_name1)
        self.assertEqual(ingest_result1["rows_ingested"], len(self.sheet1_data))

        # Verify data in DuckDB for Sheet1_Data
        duckdb_df1 = self.db_conn.execute(f"SELECT * FROM {expected_table_name1}").fetchdf()
        # Convert all columns to object type before comparison to avoid dtype mismatches with read_excel
        # This is a common strategy when dtypes are not strictly controlled or critical for the test's purpose.
        # Alternatively, ensure precise dtype matching if that's a requirement.
        pd_testing.assert_frame_equal(duckdb_df1.astype(object), self.sheet1_data.astype(object), check_dtype=False)


        # Test ingesting Another_Sheet with a custom name using 'name_as'
        custom_table_name = "CustomSheetName"
        ingest_result2 = loader.ingest_data(table_name=self.sheet2_name, name_as=custom_table_name)
        expected_table_name2 = sanitize_table_name(custom_table_name)

        self.assertEqual(ingest_result2["status"], "success")
        self.assertEqual(ingest_result2["table_name"], expected_table_name2)
        self.assertEqual(ingest_result2["rows_ingested"], len(self.sheet2_data))

        # Verify data in DuckDB for Another_Sheet (with custom name)
        duckdb_df2 = self.db_conn.execute(f"SELECT * FROM {expected_table_name2}").fetchdf()
        pd_testing.assert_frame_equal(duckdb_df2.astype(object), self.sheet2_data.astype(object), check_dtype=False)

    def test_ingest_data_sheet_not_found(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
        with self.assertRaisesRegex(ValueError, "Sheet 'NonExistentSheet' not found in the Excel file."):
            loader.ingest_data(table_name="NonExistentSheet")

    def test_view_query_sample_success(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
        
        # Test viewing sample for Sheet1_Data
        sample_json_str = loader.view_query_sample(query=self.sheet1_name)
        sample_data = json.loads(sample_json_str)

        self.assertEqual(len(sample_data), len(self.sheet1_data)) # Should return all 3 rows as it's less than 5
        # Verify the first row's content (adjusting for potential type differences from JSON conversion if necessary)
        # For simplicity, comparing as read by pandas initially.
        expected_first_row = self.sheet1_data.iloc[0].to_dict()
        self.assertDictEqual(sample_data[0], expected_first_row)

        # Test viewing sample for Another_Sheet (which has 4 rows, so all should be returned)
        sample_json_str_2 = loader.view_query_sample(query=self.sheet2_name)
        sample_data_2 = json.loads(sample_json_str_2)
        self.assertEqual(len(sample_data_2), len(self.sheet2_data)) # All 4 rows
        expected_first_row_2 = self.sheet2_data.iloc[0].to_dict()
        self.assertDictEqual(sample_data_2[0], expected_first_row_2)

    def test_view_query_sample_sheet_not_found(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
        with self.assertRaisesRegex(ValueError, "Sheet 'NonExistentSheet' not found in the Excel file."):
            loader.view_query_sample(query="NonExistentSheet")

    def test_ingest_data_from_query_not_implemented(self):
        loader = ExcelDataLoader(params={"file_path": self.excel_file_path}, duck_db_conn=self.db_conn)
        with self.assertRaises(NotImplementedError):
            loader.ingest_data_from_query(query="SELECT * FROM SomeSheet", name_as="some_table")

if __name__ == '__main__':
    unittest.main()
