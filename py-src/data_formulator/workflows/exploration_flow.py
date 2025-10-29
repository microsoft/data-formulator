# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
from this import d
import pandas as pd
from typing import Dict, List, Any, Optional, Tuple, Generator

from data_formulator.agents.agent_exploration import ExplorationAgent
from data_formulator.agents.agent_interactive_explore import InteractiveExploreAgent
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent
from data_formulator.agents.client_utils import Client
from data_formulator.db_manager import db_manager
from data_formulator.workflows.create_vl_plots import assemble_vegailte_chart, spec_to_base64, detect_field_type
from data_formulator.agents.agent_utils import extract_json_objects

logger = logging.getLogger(__name__)

def create_chart_spec_from_data(
    transformed_data: Dict[str, Any], 
    chart_type: str, 
    chart_encodings: Dict[str, str]
) -> str:
    """
    Create a chart from transformed data using Vega-Lite.
    
    Args:
        transformed_data: Dictionary with 'rows' key containing the data
        chart_type: Type of chart to create (bar, point, line, etc.)
        chart_encodings: Dictionary mapping channel names to field names (e.g., {"x": "field1", "y": "field2"})
        
    Returns:
        Base64 encoded PNG image string
    """
    try:
        # Convert data to DataFrame
        df = pd.DataFrame(transformed_data['rows'])
        
        if df.empty:
            logger.warning("Empty dataframe, cannot create chart")
            return ""
        
        # Convert chart_encodings to the format expected by assemble_vegailte_chart
        encodings = {}
        for channel, field in chart_encodings.items():
            if field and field in df.columns:
                # Determine field type for encoding
                field_type = detect_field_type(df[field])
                encodings[channel] = {"field": field, "type": field_type}
        
        # Create Vega-Lite specification
        spec = assemble_vegailte_chart(df, chart_type, encodings)
        
        return spec
        
    except Exception as e:
        logger.error(f"Error creating chart: {e}")
        return None

def run_exploration_flow_streaming(
    model_config: Dict[str, str],
    input_tables: List[Dict[str, Any]],
    initial_plan: List[str],
    language: str = "python",
    session_id: Optional[str] = None,
    exec_python_in_subprocess: bool = False,
    max_iterations: int = 5,
    max_repair_attempts: int = 1,
    agent_exploration_rules: str = "",
    agent_coding_rules: str = ""
) -> Generator[Dict[str, Any], None, None]:
    """
    Run the complete exploration flow from high-level question to final insights as a streaming generator.
    
    Args:
        model_config: Dictionary with endpoint, model, api_key, api_base, api_version
        input_tables: List of input table dictionaries with 'name' 'rows' and 'attached_metadata'
        plan: List of steps to continue exploring
        language: "python" or "sql" for data transformation
        session_id: Database session ID for SQL connections
        exec_python_in_subprocess: Whether to execute Python in subprocess
        max_iterations: Maximum number of exploration iterations
        max_repair_attempts: Maximum number of code repair attempts
        agent_exploration_rules: Custom exploration rules for the agent
        agent_coding_rules: Custom coding rules for the agent
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
    previous_transformation_dialog = []
    previous_transformation_data = []
    
    # Initialize client and agents
    client = Client.from_config(model_config)

    if language == "sql":
        if session_id:
            db_conn = db_manager.get_connection(session_id)
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
        db_conn = None
    
    # This is the exploration agent that revises the exploration plan
    exploration_agent = ExplorationAgent(client, db_conn=db_conn, agent_exploration_rules=agent_exploration_rules)

    # rec agent for data transformation
    if language == "sql":
        rec_agent = SQLDataRecAgent(client=client, conn=db_conn, agent_coding_rules=agent_coding_rules)
    else:
        rec_agent = PythonDataRecAgent(
            client=client, 
            exec_python_in_subprocess=exec_python_in_subprocess,
            agent_coding_rules=agent_coding_rules
        )

    completed_steps = []
    current_question = initial_plan[0] if len(initial_plan) > 0 else "Let's explore something interesting."
    current_plan = initial_plan[1:] 
    
    # Collect exploration plans at each step
    exploration_plan_list = []
    
    # Track initial plan if provided
    if len(initial_plan) > 1:
        exploration_plan_list.append({
            "ref_tables": [{"name": table['name'], "rows": table['rows'][:5] if 'rows' in table else []} for table in input_tables],
            "plan": initial_plan[1:]
        })

    # Main exploration loop
    while iteration < max_iterations + 1:
        iteration += 1
        
        # Step 1: Use rec agent to transform data based on current question
        logger.info(f"Iteration {iteration}: Using rec agent for question: {current_question}")
        
        attempt = 0
        if previous_transformation_dialog:

            if isinstance(previous_transformation_data, dict) and 'rows' in previous_transformation_data:
                latest_data_sample = previous_transformation_data['rows']
            else:
                latest_data_sample = []  # Use empty list as fallback
            
            transformation_results = rec_agent.followup(
                input_tables=input_tables,
                new_instruction=current_question,
                latest_data_sample=latest_data_sample,
                dialog=previous_transformation_dialog
            )
        else:
            transformation_results = rec_agent.run(
                input_tables=input_tables,
                description=current_question
            )

        # give one attempt to fix potential errors
        while (not transformation_results or transformation_results[0]['status'] != 'ok'):

            if attempt >= max_repair_attempts or not transformation_results:
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

        # if the transformation results is not ok, yield an error and break
        if transformation_results[0]['status'] != 'ok':
            yield {
                "iteration": iteration,
                "type": "data_transformation",
                "content": {},
                "status": "error",
                "error_message": transformation_results[0]['content']
            }
            break

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
        chart_encodings = refined_goal.get('chart_encodings', {})
        
        chart_spec = create_chart_spec_from_data(
            transformed_data,
            chart_type,
            chart_encodings
        )
        current_visualization = spec_to_base64(chart_spec) if chart_spec else None
        
        # Store this step for exploration analysis
        step_data = {
            'question': current_question,
            'code': code,
            'data': {"rows": transformed_data['rows'], "name": transformed_data['virtual']['table_name'] if 'virtual' in transformed_data else None },
            'visualization': current_visualization
        }
        completed_steps.append(step_data)

        # Step 3: Use exploration agent to analyze results and decide next step
        logger.info(f"Iteration {iteration}: Using exploration agent to decide next step")
        
        followup_results = exploration_agent.suggest_followup(
            input_tables=input_tables,
            completed_steps=completed_steps,
            next_steps=current_plan
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
                    "message": followup_plan.get('summary', ''),
                    "total_steps": len(completed_steps),
                    "exploration_plan_list": exploration_plan_list
                },
                "status": "success" if followup_plan.get('status') == 'present' else "warning",
                "error_message": ""
            }
            break

        current_plan = followup_plan.get('next_steps', [])
        current_question = current_plan.pop(0)
        
        # Collect updated plan from exploration agent
        # Get table from last completed step (this is the table used for generating the new plan)
        if completed_steps:
            last_step_data = completed_steps[-1]['data']
            last_step_table = [{
                "name": last_step_data.get('name'),
                "rows": last_step_data.get('rows', [])[:5]
            }]
        else:
            last_step_table = [{"name": table['name'], "rows": table['rows'][:5] if 'rows' in table else []} for table in input_tables]
        
        exploration_plan_list.append({
            "ref_tables": last_step_table,
            "plan": current_plan.copy()
        })

        yield {
            "iteration": iteration,
            "type": "planning",
            "content": {
                "message": current_question,
                "exploration_steps_count": len(completed_steps)
            },
            "status": "success",
            "error_message": ""
        }
        
    # Clean up connection if used
    if db_conn:
        db_conn.close()
        
    # If we hit max iterations without presenting
    if iteration >= max_iterations:
        yield {
            "iteration": iteration,
            "type": "completion",
            "content": {
                "total_steps": len(completed_steps),
                "reason": "Reached maximum iterations",
                "exploration_plan_list": exploration_plan_list
            },
            "status": "success",
            "error_message": "Reached maximum iterations"
        }