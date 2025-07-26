"""
Data Formulator Public API

This module provides the main public interface for external users of Data Formulator.
"""

import pandas as pd
from typing import Dict, List, Any, Union
import logging
import base64 # Added missing import for base64

logger = logging.getLogger(__name__)

from data_formulator.workflows.exploration_flow import (
    fields_to_encodings, 
    assemble_vegailte_chart, 
    spec_to_base64,
)
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.client_utils import Client, OpenAIClientAdapter

# Chart creation functions
def create_chart_from_fields(df: pd.DataFrame, fields: List[str], chart_type: str, output_path: str = None) -> str:
    """
    Create a chart from DataFrame using field list.
    
    Args:
        df: pandas DataFrame with data
        fields: List of column names to visualize  
        chart_type: Chart type (bar, point, line, area, heatmap, boxplot, group_bar)
        output_path: Path to save the chart image (optional)
    Returns:
        Base64 encoded PNG image string
        
    Raises:
        ValueError: If DataFrame is empty, fields list is empty, or invalid chart type
        RuntimeError: If chart creation fails due to data or encoding issues
    """
    if df.empty:
        raise ValueError("DataFrame is empty - cannot create chart")
    
    if not fields:
        raise ValueError("Fields list is empty - cannot create chart")
        
    try:
        # Auto-assign fields to encodings based on chart type
        encodings = fields_to_encodings(df, chart_type, fields)
        
        # Create Vega-Lite specification
        spec = assemble_vegailte_chart(df, chart_type, encodings)
        
        # Convert to base64 PNG
        chart_image = spec_to_base64(spec, scale=2.0)
        if output_path:
            base64_data = chart_image.split(',', 1)[1]
            with open(output_path, 'wb') as f:
                f.write(base64.b64decode(base64_data))
        return chart_image
        
    except Exception as e:
        logger.error(f"Error creating chart from fields: {e}")
        raise RuntimeError(f"Failed to create chart: {e}") from e


# Data transformation function
def transform_data_with_nl(
    client: Union[Client, OpenAIClientAdapter],
    df: pd.DataFrame, 
    transformation_goal: str,   
    expected_fields: List[str] = []
) -> Dict[str, Any]:
    """
    Transform data using natural language description with Python.
    
    Args:
        df: Input pandas DataFrame
        transformation_goal: Natural language description of transformation
        model_config: Dict with endpoint, model, api_key, api_base, api_version
        expected_fields: List of field names expected in the output data (optional)

    Returns:
        Dict with:
        - data: transformed data as DataFrame  
        - reasoning: transformation reasoning and dialog
        - code: python code for transformation
        
    Raises:
        ValueError: If DataFrame is empty, transformation_goal is empty, or model_config is invalid
        RuntimeError: If data transformation fails
    """
    if df.empty:
        raise ValueError("DataFrame is empty - cannot transform data")
    
    if not transformation_goal or not transformation_goal.strip():
        raise ValueError("Transformation goal is empty - please provide a description")
    
    try:
        # Create client and input table format
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
            raise RuntimeError("No transformation results returned from agent")
        
        result = {
            "reasoning": transform_result['refined_goal'],
            "code": transform_result['code'],
            "data": pd.DataFrame(transform_result['transformed_data']['rows'])
        }
        
        return result
        
    except Exception as e:
        logger.error(f"Error in data transformation: {e}")
        if isinstance(e, (ValueError, RuntimeError)):
            raise
        raise RuntimeError(f"Data transformation failed: {e}") from e


# Comprehensive natural language chart generation
def generate_chart_from_nl(
    client: Union[Client, OpenAIClientAdapter],
    df: pd.DataFrame, 
    instruction: str, 
    output_path: str = None
) -> Dict[str, Any]:
    """
    Generate chart from DataFrame and natural language using data recommendation agent.
    
    Args:
        client: Client or OpenAIClientWrapper instance
        df: Input pandas DataFrame
        instruction: Natural language description of desired chart/analysis
        output_path: Path to save the chart image (optional)
    Returns:
        Dict with:
        - chart_image: base64 encoded PNG image (if successful)
        - chart_spec: Vega-Lite specification of chart
        - chart_type: type of chart created
        - fields: fields used in visualization
        - transformed_data: processed data as DataFrame
        - reasoning: planning and transformation reasoning
        
    Raises:
        ValueError: If DataFrame is empty, natural language description is empty, or model_config is invalid
        RuntimeError: If chart generation fails
    """
    if df.empty:
        raise ValueError("DataFrame is empty - cannot generate chart")
    
    if not instruction or not instruction.strip():
        raise ValueError("Natural language description is empty - please provide a description")
    
    try:
        input_tables = [{"name": "data", "rows": df.to_dict('records')}]
        
        # Create data recommendation agent
        data_rec_agent = PythonDataRecAgent(client=client)
        
        # Get data recommendation and transformation
        recommendation_results = data_rec_agent.run(
            input_tables=input_tables,
            description=instruction
        )
        
        if not recommendation_results:
            raise RuntimeError("No recommendation results returned from agent")
        
        if recommendation_results[0]['status'] != 'ok':
            error_content = recommendation_results[0].get('content', 'Unknown error')
            raise RuntimeError(f"Data recommendation failed: {error_content}")
        
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

        if output_path:
            base64_data = chart_image.split(',', 1)[1]
            with open(output_path, 'wb') as f:
                f.write(base64.b64decode(base64_data))
        
        return {
            "chart_image": chart_image,
            "chart_spec": spec,
            "chart_type": chart_type,
            "fields": visualization_fields,
            "transformed_data": result_df,
            "reasoning": {
                "recommendation": refined_goal.get('recommendation', ''),
                "mode": refined_goal.get('mode', ''),
                "output_fields": refined_goal.get('output_fields', []),
            }
        }
        
    except Exception as e:
        logger.error(f"Error generating chart from NL: {e}")
        if isinstance(e, (ValueError, RuntimeError)):
            raise
        raise RuntimeError(f"Chart generation failed: {e}") from e
        

__all__ = [
    'Client',
    'OpenAIClientAdapter',
    
    # Primary chart creation
    'create_chart_from_fields',
    'generate_chart_from_nl',

    # Data transformation
    'transform_data_with_nl', 
]