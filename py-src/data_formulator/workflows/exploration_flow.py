# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
from this import d
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple, Generator

from data_formulator.agents.agent_exploration import ExplorationAgent
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent
from data_formulator.agents.client_utils import Client
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
        chart_type: Type of chart to create (bar, point, line, etc.)
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
        - type: "data_transformation", "visualization", "planning", or "completion" 
        - data: Step-specific data (plan details, results, or final insights)
        - status: "success" or "error"
        - error_message: Error details if status is "error"
        
    The function is complete when a yield with type="completion" is emitted.
    """
    # Initialize variables
    iteration = 0
    exploration_steps = []
    current_question = start_question
    previous_transformation_dialog = []
    previous_transformation_data = []
    
    # Initialize client and agents
    client = Client.from_config(model_config)
    exploration_agent = ExplorationAgent(client)
    
    # Initialize rec agent based on language
    conn = None
    if language == "sql":
        if session_id:
            conn = db_manager.get_connection(session_id)
            rec_agent = SQLDataRecAgent(client=client, conn=conn)
        else:
            yield {
                "iteration": iteration,
                "type": "data_transformation",
                "content": {},
                "status": "error",
                "error_message": "Session ID required for SQL transformations"
            }
            return
    else:
        rec_agent = PythonDataRecAgent(
            client=client,
            exec_python_in_subprocess=exec_python_in_subprocess
        )
    
    # Main exploration loop
    while iteration < max_iterations:
        iteration += 1
        
        # Step 1: Use rec agent to transform data based on current question
        logger.info(f"Iteration {iteration}: Using rec agent for question: {current_question}")
        
        attempt = 0
        if previous_transformation_dialog:
            transformation_results = rec_agent.followup(
                input_tables=input_tables,
                new_instruction=current_question,
                latest_data_sample=previous_transformation_data['rows'],
                dialog=previous_transformation_dialog
            )
        else:
            transformation_results = rec_agent.run(
                input_tables=input_tables,
                description=current_question
            )

        # give one attempt to fix potential errors
        while (not transformation_results or transformation_results[0]['status'] != 'ok'):

            if attempt >= 1 or not transformation_results:
                yield {
                    "iteration": iteration,
                    "type": "data_transformation",
                    "content": {"question": current_question},
                    "status": "error",
                    "error_message": "data transformation failed"
                }
                break

            attempt += 1
            error_msg = transformation_results[0]['content'] 
            dialog = transformation_results[0]['dialog']

            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_msg}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
            transformation_results = rec_agent.followup(
                input_tables=input_tables,
                new_instruction=new_instruction,
                latest_data_sample=[],
                dialog=dialog
            )

        # Extract transformation result
        transform_result = transformation_results[0]
        transformed_data = transform_result['content']
        refined_goal = transform_result.get('refined_goal', {})
        code = transform_result.get('code', '')
        previous_transformation_dialog = transform_result.get('dialog', [])
        previous_transformation_data = transformed_data

        yield {
            "iteration": iteration,
            "type": "data_transformation",
            "content": {
                "question": current_question,
                "result": transform_result
            },
            "status": "success",
            "error_message": ""
        }
        
        # Step 2: Create visualization to help generate followup question
        chart_type = refined_goal.get('chart_type', 'bar')
        visualization_fields = refined_goal.get('visualization_fields', [])
        
        chart_spec = create_chart_spec_from_data(
            transformed_data,
            chart_type,
            visualization_fields
        )
        current_visualization = spec_to_base64(chart_spec) if chart_spec else None
        
        # Store this step for exploration analysis
        step_data = {
            'question': current_question,
            'code': code,
            'data': transformed_data,
            'visualization': current_visualization
        }
        exploration_steps.append(step_data)

        print(f"Exploration steps {iteration}:")
        print({
            'question': current_question,
            'code': code,
            'data': str(transformed_data)[:1000],
        })

        # Step 3: Use exploration agent to analyze results and decide next step
        logger.info(f"Iteration {iteration}: Using exploration agent to decide next step")
        
        followup_results = exploration_agent.suggest_followup(
            input_tables=input_tables,
            steps=exploration_steps
        )

        
        if not followup_results or followup_results[0]['status'] != 'ok':
            error_msg = followup_results[0]['content'] if followup_results else "Follow-up planning failed"
            yield {
                "iteration": iteration,
                "type": "planning",
                "content": {},
                "status": "error",
                "error_message": error_msg
            }
            break
        
        # Extract follow-up decision
        followup_plan = followup_results[0]['content']
        
        # Check if exploration agent decides to present findings
        if followup_plan.get('status') in ['present', 'warning']:
            yield {
                "iteration": iteration,
                "type": "completion",
                "content": {
                    "plan": followup_plan,
                    "total_steps": len(exploration_steps),
                },
                "status": "success" if followup_plan.get('status') == 'present' else "warning",
                "error_message": ""
            }
            break


        yield {
            "iteration": iteration,
            "type": "planning",
            "content": {
                "plan": followup_plan,
                "exploration_steps_count": len(exploration_steps)
            },
            "status": "success",
            "error_message": ""
        }
        
        # Continue with new question from instruction
        current_question = followup_plan.get('instruction', '')
            
    # Clean up connection if used
    if conn:
        conn.close()
        
    # If we hit max iterations without presenting
    if iteration >= max_iterations:
        yield {
            "iteration": iteration,
            "type": "completion",
            "content": {
                "total_steps": len(exploration_steps),
                "reason": "Reached maximum iterations"
            },
            "status": "success",
            "error_message": "Reached maximum iterations"
        }
        

    