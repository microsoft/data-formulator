# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple, Generator

from data_formulator.agents.agent_exploration import ExplorationAgent
from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.agent_sql_data_transform import SQLDataTransformationAgent
from data_formulator.agents.client_utils import get_client, Client
from data_formulator.db_manager import db_manager
from data_formulator.workflows.create_vl_plots import assemble_vegailte_chart, spec_to_base64, fields_to_encodings

logger = logging.getLogger(__name__)

def create_chart_spec_from_data(
    transformed_data: Dict[str, Any], 
    chart_type: str, 
    visualization_fields: List[str]
) -> str:
    """
    Create a chart from transformed data using Vega-Lite.
    
    Args:
        transformed_data: Dictionary with 'rows' key containing the data
        chart_type: Type of chart to create (bar, point, line, boxplot, etc.)
        visualization_fields: List of field names to visualize
        
    Returns:
        Base64 encoded PNG image string
    """
    try:
        # Convert data to DataFrame
        df = pd.DataFrame(transformed_data['rows'])
        
        if df.empty:
            logger.warning("Empty dataframe, cannot create chart")
            return ""
        
        # Create encodings based on chart type and visualization fields
        encodings = fields_to_encodings(df, chart_type, visualization_fields)
        
        # Create Vega-Lite specification
        spec = assemble_vegailte_chart(df, chart_type, encodings)
        
        return spec
        
    except Exception as e:
        logger.error(f"Error creating chart: {e}")
        return None

def run_exploration_flow_streaming(
    model_config: Dict[str, str],
    input_tables: List[Dict[str, Any]],
    start_question: str,
    language: str = "python",
    session_id: Optional[str] = None,
    exec_python_in_subprocess: bool = False,
    max_iterations: int = 5
) -> Generator[Dict[str, Any], None, None]:
    """
    Run the complete exploration flow from high-level question to final insights as a streaming generator.
    
    Args:
        model_config: Dictionary with endpoint, model, api_key, api_base, api_version
        input_tables: List of input table dictionaries with 'name' and 'rows'
        start_question: User's high-level exploration question
        language: "python" or "sql" for data transformation
        session_id: Database session ID for SQL connections
        exec_python_in_subprocess: Whether to execute Python in subprocess
        max_iterations: Maximum number of exploration iterations
        
    Yields:
        Dictionary containing:
        - iteration: Current iteration number
        - type: "planning", "visualization", or "completion" 
        - data: Step-specific data (plan details, results, or final insights)
        - status: "success" or "error"
        - error_message: Error details if status is "error"
        
    The function is complete when a yield with type="completion" is emitted.
    """
    # Initialize variables for error handling
    iteration = 0
    current_transformed_data = None
    current_visualization = None
    
    # Initialize client and agents
    client = get_client(model_config)
    exploration_agent = ExplorationAgent(client)
    
    # Track iteration and dialog context
    planning_dialog = []
    transformation_dialog = []
    
    # Get initial exploration plan
    initial_results = exploration_agent.initial(input_tables, start_question)
    
    if not initial_results or initial_results[0]['status'] != 'ok':
        error_msg = initial_results[0]['content'] if initial_results else "No initial plan generated"
        yield {
            "iteration": iteration,
            "type": "planning",
            "data": {},
            "status": "error", 
            "error_message": error_msg
        }
        return
        
    # Extract initial plan
    plan = initial_results[0]['content']
    planning_dialog = initial_results[0].get('dialog', [])
    
    yield {
        "iteration": iteration,
        "type": "planning",
        "data": {"plan": plan},
        "status": "success",
        "error_message": ""
    }
    
    # Main exploration loop
    while iteration < max_iterations:
        iteration += 1
        
        # Step 1: Execute data transformation
        conn = None
        if language == "sql":
            if session_id:
                conn = db_manager.get_connection(session_id)
                agent = SQLDataTransformationAgent(client=client, conn=conn)
            else:
                yield {
                    "iteration": iteration,
                    "type": "data_transformation",
                    "data": {},
                    "status": "error",
                    "error_message": "Session ID required for SQL transformations"
                }
                return
        else:
            agent = PythonDataTransformationAgent(
                client=client,
                exec_python_in_subprocess=exec_python_in_subprocess
            )
        
        # Run data transformation
        transformation_results = agent.run(
            input_tables=input_tables,
            description=plan.get('action', {}).get('data_transformation_goal', ''),
            expected_fields=plan.get('action', {}).get('expected_output_fields', []),
            prev_messages=transformation_dialog
        )
        
        # Clean up connection
        if conn:
            conn.close()
        
        if not transformation_results or transformation_results[0]['status'] != 'ok':
            error_msg = transformation_results[0]['content'] if transformation_results else "Data transformation failed"
            yield {
                "iteration": iteration,
                "type": "visualization",
                "data": {},
                "status": "error",
                "error_message": error_msg
            }
            continue
        
        # Extract transformed data
        current_transformed_data = transformation_results[0]['content']
        transformation_dialog = transformation_results[0].get('dialog', [])

        chart_type = plan.get('action', {}).get('visualization_type', 'bar')
        visualization_fields = plan.get('action', {}).get('visualization_fields', [])
        
        # Create visualization
        chart_spec = create_chart_spec_from_data(
            current_transformed_data,
            chart_type,
            visualization_fields
        )
        current_visualization = spec_to_base64(chart_spec, width=600, height=400) if chart_spec else None
        
        yield {
            "iteration": iteration,
            "type": "visualization",
            "data": {
                "transformed_data": current_transformed_data,
                "chart_spec": chart_spec,
                "chart_image": current_visualization
            },
            "status": "success",
            "error_message": ""
        }
        
        # Step 2: Followup planning
        followup_results = exploration_agent.followup(
            current_transformed_data,
            current_visualization,
            planning_dialog
        )
        
        if not followup_results or followup_results[0]['status'] != 'ok':
            error_msg = followup_results[0]['content'] if followup_results else "Followup planning failed"
            yield {
                "iteration": iteration,
                "type": "planning",
                "data": {},
                "status": "error",
                "error_message": error_msg
            }
            break
        
        # Extract followup plan
        followup_plan = followup_results[0]['content']
        planning_dialog = followup_results[0].get('dialog', [])
        
        yield {
            "iteration": iteration,
            "type": "planning",
            "data": {"plan": followup_plan},
            "status": "success",
            "error_message": ""
        }
        
        # Check if we should stop exploring
        if followup_plan.get('status') == 'present':
            # Yield final completion with exploration results
            yield {
                "iteration": iteration,
                "type": "completion",
                "data": {
                    "reason": "exploration_complete",
                    "assessment": followup_plan.get('assessment', ''),
                    "reasoning": followup_plan.get('reasoning', ''),
                    "final_data": current_transformed_data,
                    "final_visualization": current_visualization
                },
                "status": "success",
                "error_message": ""
            }
            break
        
        # Continue with new plan
        plan = followup_plan
            
        # If we hit max iterations without presenting
        if iteration >= max_iterations:
            yield {
                "iteration": iteration,
                "type": "completion",
                "data": {},
                "status": "success",
                "error_message": "Reached maximum iterations"
            }
        

    