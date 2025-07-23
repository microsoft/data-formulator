"""
Data Formulator Public API

This module provides the main public interface for external users of Data Formulator.
"""

import pandas as pd
from typing import Dict, List, Any
import logging

logger = logging.getLogger(__name__)

from data_formulator.workflows.exploration_flow import (
    fields_to_encodings, 
    assemble_vegailte_chart, 
    spec_to_base64,
)
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.client_utils import get_client

# Chart creation functions
def create_chart_from_fields(df: pd.DataFrame, fields: List[str], chart_type: str) -> str:
    """
    Create a chart from DataFrame using field list.
    
    Args:
        df: pandas DataFrame with data
        fields: List of column names to visualize  
        chart_type: Chart type (bar, point, line, area, heatmap, boxplot)
        
    Returns:
        Base64 encoded PNG image string
    """
    try:
        if df.empty or not fields:
            return ""
            
        # Auto-assign fields to encodings based on chart type
        encodings = fields_to_encodings(df, chart_type, fields)
        
        # Create Vega-Lite specification
        spec = assemble_vegailte_chart(df, chart_type, encodings)
        
        # Convert to base64 PNG
        return spec_to_base64(spec, scale=2.0)
        
    except Exception as e:
        logger.error(f"Error creating chart from fields: {e}")
        return ""


def create_chart_from_encodings(df: pd.DataFrame, encodings: Dict[str, Dict[str, str]], chart_type: str) -> str:
    """
    Create a chart from DataFrame using explicit encodings.
    
    Args:
        df: pandas DataFrame with data
        encodings: Dict mapping channels to field specs, e.g. {"x": {"field": "col1"}, "y": {"field": "col2"}}
        chart_type: Chart type (bar, point, line, area, heatmap, boxplot)
        
    Returns:
        Base64 encoded PNG image string
    """
    try:
        if df.empty or not encodings:
            return ""
            
        # Create Vega-Lite specification
        spec = assemble_vegailte_chart(df, chart_type, encodings)
        
        # Convert to base64 PNG
        return spec_to_base64(spec, scale=2.0)
        
    except Exception as e:
        logger.error(f"Error creating chart from encodings: {e}")
        return ""

# Data transformation function
def transform_data_with_nl(
    df: pd.DataFrame, 
    transformation_goal: str, 
    model_config: Dict[str, str],
    expected_fields: List[str] = []
) -> Dict[str, Any]:
    """
    Transform data using natural language description with Python.
    
    Args:
        df: Input pandas DataFrame
        transformation_goal: Natural language description of transformation
        model_config: Dict with endpoint, model, api_key, api_base, api_version
        expected_fields: List of expected output field names (optional)

    Returns:
        Dict with:
        - success: bool indicating if transformation succeeded
        - data: transformed data as DataFrame (if successful)  
        - error: error message (if failed)
        - reasoning: transformation reasoning and dialog
    """
    try:
        # Create client and input table format
        client = get_client(model_config)
        input_tables = [{"name": "data", "rows": df.to_dict('records')}]
        
        # Execute transformation using Python
        transform_agent = PythonDataTransformationAgent(client=client)
        results = transform_agent.run(
            input_tables=input_tables,
            description=transformation_goal,
            expected_fields=expected_fields
        )
        
        # Get the first (best) result
        transform_result = results[0] if results and len(results) > 0 else None
        
        if transform_result is None:
            result = {
                "success": False,
                "error": "Data transformation failed",
                "reasoning": {},
                "code": "",
                "data": None
            }
        else:
            result = {
                "success": True,
                "error": "",
                "reasoning": transform_result['refined_goal'],
                "code": transform_result['code'],
                "data": pd.DataFrame(transform_result['transformed_data']['rows'])
            }
        
        return result
        
    except Exception as e:
        logger.error(f"Error in data transformation: {e}")
        return {
            "success": False,
            "error": str(e),
            "reasoning": {},
            "data": None
        }


# Comprehensive natural language chart generation
def generate_chart_from_nl(df: pd.DataFrame, nl: str, model_config: Dict[str, str]) -> Dict[str, Any]:
    """
    Generate chart from DataFrame and natural language using data recommendation agent.
    
    Args:
        df: Input pandas DataFrame
        nl: Natural language description of desired chart/analysis
        model_config: Dict with endpoint, model, api_key, api_base, api_version
        
    Returns:
        Dict with:
        - success: bool indicating if generation succeeded
        - chart_image: base64 encoded PNG image (if successful)
        - chart_type: type of chart created
        - fields: fields used in visualization
        - transformed_data: processed data as DataFrame
        - reasoning: planning and transformation reasoning
        - error: error message (if failed)
    """
    try:
        # Create client and setup
        client = get_client(model_config)
        input_tables = [{"name": "data", "rows": df.to_dict('records')}]
        
        # Create data recommendation agent
        data_rec_agent = PythonDataRecAgent(client=client)
        
        # Get data recommendation and transformation
        recommendation_results = data_rec_agent.run(
            input_tables=input_tables,
            description=nl
        )
        
        if not recommendation_results or recommendation_results[0]['status'] != 'ok':
            error_msg = recommendation_results[0]['content'] if recommendation_results else "Failed to get data recommendation"
            return {
                "success": False,
                "error": error_msg,
                "chart_image": "",
                "chart_type": "",
                "fields": [],
                "transformed_data": None,
                "reasoning": {}
            }
        
        # Extract recommendation details
        result = recommendation_results[0]
        refined_goal = result['refined_goal']
        transformed_data = result['content']
        
        # Generate chart using the transformed data and recommended visualization
        result_df = pd.DataFrame(transformed_data['rows'])
        chart_type = refined_goal.get('chart_type', 'point')
        visualization_fields = refined_goal.get('visualization_fields', [])
        
        # Create encodings and generate chart
        encodings = fields_to_encodings(result_df, chart_type, visualization_fields)
        spec = assemble_vegailte_chart(result_df, chart_type, encodings)
        chart_image = spec_to_base64(spec, scale=2.0)
        
        return {
            "success": True,
            "chart_image": chart_image,
            "chart_type": chart_type,
            "fields": visualization_fields,
            "transformed_data": result_df,
            "reasoning": {
                "recommendation": refined_goal.get('recommendation', ''),
                "mode": refined_goal.get('mode', ''),
                "output_fields": refined_goal.get('output_fields', []),
                "dialog": result.get('dialog', [])
            },
            "error": ""
        }
        
    except Exception as e:
        logger.error(f"Error generating chart from NL: {e}")
        return {
            "success": False,
            "error": str(e),
            "chart_image": "",
            "chart_type": "",
            "fields": [],
            "transformed_data": None,
            "reasoning": {}
        }

__all__ = [
    # Primary chart creation
    'create_chart_from_fields',
    'create_chart_from_encodings',
    'generate_chart_from_nl',

    # Data transformation
    'transform_data_with_nl', 
]