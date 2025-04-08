# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import random
import sys
import os
import mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import Flask, request, send_from_directory, has_request_context, redirect, url_for, session, jsonify
from flask import stream_with_context, Response
import html
import pandas as pd

import webbrowser
import threading

import logging

import json
import time
from pathlib import Path

from vega_datasets import data as vega_data

from data_formulator.agents.agent_concept_derive import ConceptDeriveAgent
from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.agent_sql_data_transform import SQLDataTransformationAgent
from data_formulator.agents.agent_py_data_rec import PythonDataRecAgent
from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent

from data_formulator.agents.agent_sort_data import SortDataAgent
from data_formulator.agents.agent_data_load import DataLoadAgent
from data_formulator.agents.agent_data_clean import DataCleanAgent
from data_formulator.agents.agent_code_explanation import CodeExplanationAgent

from data_formulator.agents.client_utils import Client

from dotenv import load_dotenv
import secrets

from data_formulator.db_manager import db_manager

APP_ROOT = Path(os.path.join(Path(__file__).parent)).absolute()

import os

app = Flask(__name__, static_url_path='', static_folder=os.path.join(APP_ROOT, "dist"))
app.secret_key = secrets.token_hex(16)  # Generate a random secret key for sessions

print(APP_ROOT)

# Load the single environment file
load_dotenv(os.path.join(APP_ROOT, "..", "..", 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, '.env'))

# Configure root logger for general application logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Get logger for this module
logger = logging.getLogger(__name__)

# Configure Flask app logger to use the same settings
app.logger.handlers = []
for handler in logging.getLogger().handlers:
    app.logger.addHandler(handler)

# Example usage:
logger.info("Application level log")  # General application logging
app.logger.info("Flask specific log") # Web request related logging

def get_client(model_config):
    for key in model_config:
        model_config[key] = model_config[key].strip()

    client = Client(
        model_config["endpoint"],
        model_config["model"],
        model_config["api_key"] if "api_key" in model_config else None,
        html.escape(model_config["api_base"]) if "api_base" in model_config else None,
        model_config["api_version"] if "api_version" in model_config else None)

    return client

@app.route('/api/vega-datasets')
def get_example_dataset_list():
    dataset_names = vega_data.list_datasets()
    example_datasets = [
        {"name": "gapminder", "challenges": [
            {"text": "Create a line chart to show the life expectancy trend of each country over time.", "difficulty": "easy"},
            {"text": "Visualize the top 10 countries with highest life expectancy in 2005.", "difficulty": "medium"},
            {"text": "Find top 10 countries that have the biggest difference of life expectancy in 1955 and 2005.", "difficulty": "hard"},
            {"text": "Rank countries by their average population per decade. Then only show countries with population over 50 million in 2005.", "difficulty": "hard"}
        ]},
        {"name": "income", "challenges": [
            {"text": "Create a line chart to show the income trend of each state over time.", "difficulty": "easy"},
            {"text": "Only show washington and california's percentage of population in each income group each year.", "difficulty": "medium"},
            {"text": "Find the top 5 states with highest percentage of high income group in 2016.", "difficulty": "hard"}
        ]},
        {"name": "disasters", "challenges": [
            {"text": "Create a scatter plot to show the number of death from each disaster type each year.", "difficulty": "easy"},
            {"text": "Filter the data and show the number of death caused by flood or drought each year.", "difficulty": "easy"},
            {"text": "Create a heatmap to show the total number of death caused by each disaster type each decade.", "difficulty": "hard"},
            {"text": "Exclude 'all natural disasters' from the previous chart.", "difficulty": "medium"}
        ]},
        {"name": "movies", "challenges": [
            {"text": "Create a scatter plot to show the relationship between budget and worldwide gross.", "difficulty": "easy"},
            {"text": "Find the top 10 movies with highest profit after 2000 and visualize them in a bar chart.", "difficulty": "easy"},
            {"text": "Visualize the median profit ratio of movies in each genre", "difficulty": "medium"},
            {"text": "Create a scatter plot to show the relationship between profit and IMDB rating.", "difficulty": "medium"},
            {"text": "Turn the above plot into a heatmap by bucketing IMDB rating and profit, color tiles by the number of movies in each bucket.", "difficulty": "hard"}
        ]},
        {"name": "unemployment-across-industries", "challenges": [
            {"text": "Create a scatter plot to show the relationship between unemployment rate and year.", "difficulty": "easy"},
            {"text": "Create a line chart to show the average unemployment per year for each industry.", "difficulty": "medium"},
            {"text": "Find the 5 most stable industries (least change in unemployment rate between 2000 and 2010) and visualize their trend over time using line charts.", "difficulty": "medium"},
            {"text": "Create a bar chart to show the unemployment rate change between 2000 and 2010, and highlight the top 5 most stable industries with least change.", "difficulty": "hard"}
        ]}
    ]
    dataset_info = []
    print(dataset_names)
    for dataset in example_datasets:
        name = dataset["name"]
        challenges = dataset["challenges"]
        try:
            info_obj = {'name': name, 'challenges': challenges, 'snapshot': vega_data(name).to_json(orient='records')}
            dataset_info.append(info_obj)
        except:
            pass
    
    response = flask.jsonify(dataset_info)
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/vega-dataset/<path:path>')
def get_datasets(path):
    try:
        df = vega_data(path)
        # to_json is necessary for handle NaN issues
        data_object = df.to_json(None, 'records')
    except Exception as err:
        print(path)
        print(err)
        data_object = "[]"
    response = data_object
    return response

@app.route('/api/check-available-models', methods=['GET', 'POST'])
def check_available_models():
    results = []
    
    # Define configurations for different providers
    providers = ['openai', 'azure', 'anthropic', 'gemini', 'ollama']

    for provider in providers:
        # Skip if provider is not enabled
        if not os.getenv(f"{provider.upper()}_ENABLED", "").lower() == "true":
            continue
        
        api_key = os.getenv(f"{provider.upper()}_API_KEY", "")
        api_base = os.getenv(f"{provider.upper()}_API_BASE", "")
        api_version = os.getenv(f"{provider.upper()}_API_VERSION", "")
        models = os.getenv(f"{provider.upper()}_MODELS", "")

        if not (api_key or api_base):
            continue

        if not models:
            continue

        # Build config for each model
        for model in models.split(","):
            model = model.strip()
            if not model:
                continue

            model_config = {
                "id": f"{provider}-{model}-{api_key}-{api_base}-{api_version}",
                "endpoint": provider,
                "model": model,
                "api_key": api_key,
                "api_base": api_base,
                "api_version": api_version
            }
            
            try:
                client = get_client(model_config)
                response = client.get_completion(
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant."},
                        {"role": "user", "content": "Respond 'I can hear you.' if you can hear me."},
                    ]
                )
                
                if "I can hear you." in response.choices[0].message.content:
                    results.append(model_config)
            except Exception as e:
                print(f"Error testing {provider} model {model}: {e}")
                
    return json.dumps(results)

@app.route('/api/test-model', methods=['GET', 'POST'])
def test_model():
    
    if request.is_json:
        app.logger.info("# code query: ")
        content = request.get_json()

        # contains endpoint, key, model, api_base, api_version
        logger.info("content------------------------------")
        logger.info(content)

        client = get_client(content['model'])

        try:
            response = client.get_completion(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Respond 'I can hear you.' if you can hear me. Do not say anything other than 'I can hear you.'"},
                ]
            )

            logger.info(f"model: {content['model']}")
            logger.info(f"welcome message: {response.choices[0].message.content}")

            if "I can hear you." in response.choices[0].message.content:
                result = {
                    "model": content['model'],
                    "status": 'ok',
                    "message": ""
                }
        except Exception as e:
            logger.info(f"Error: {e}")
            error_message = str(e)
            result = {
                "model": content['model'],
                "status": 'error',
                "message": error_message,
            }
    else:
        result = {'status': 'error'}
    
    return json.dumps(result)

@app.route("/", defaults={"path": ""})
def index_alt(path):
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html")

@app.errorhandler(404)
def page_not_found(e):
    # your processing here
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html") #'Hello 404!' #send_from_directory(app.static_folder, "index.html")

###### test functions ######

@app.route('/api/hello')
def hello():
    values = [
            {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
            {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53},
            {"a": "G", "b": 19}, {"a": "H", "b": 87}, {"a": "I", "b": 52}
        ]
    spec =  {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "A simple bar chart with embedded data.",
        "data": { "values": values },
        "mark": "bar",
        "encoding": {
            "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
            "y": {"field": "b", "type": "quantitative"}
        }
    }
    return json.dumps(spec)


@app.route('/api/hello-stream')
def streamed_response():
    def generate():
        values = [
            {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
            {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53},
            {"a": "G", "b": 19}, {"a": "H", "b": 87}, {"a": "I", "b": 52}
        ]
        spec =  {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "description": "A simple bar chart with embedded data.",
            "data": { "values": [] },
            "mark": "bar",
            "encoding": {
                "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
                "y": {"field": "b", "type": "quantitative"}
            }
        }
        for i in range(3):
            time.sleep(3)
            spec["data"]["values"] = values[i:]
            yield json.dumps(spec)
    return Response(stream_with_context(generate()))


###### agent related functions ######

@app.route('/api/process-data-on-load', methods=['GET', 'POST'])
def process_data_on_load_request():

    if request.is_json:
        app.logger.info("# process data query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        app.logger.info(f" model: {content['model']}")
        
        agent = DataLoadAgent(client=client)
        candidates = agent.run(content["input_data"])
        
        candidates = [c['content'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/derive-concept-request', methods=['GET', 'POST'])
def derive_concept_request():

    if request.is_json:
        app.logger.info("# code query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        app.logger.info(f" model: {content['model']}")
        agent = ConceptDeriveAgent(client=client)

        #print(content["input_data"])

        candidates = agent.run(content["input_data"], [f['name'] for f in content["input_fields"]], 
                                       content["output_name"], content["description"])
        
        candidates = [c['code'] for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/clean-data', methods=['GET', 'POST'])
def clean_data_request():

    if request.is_json:
        app.logger.info("# data clean request")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        app.logger.info(f" model: {content['model']}")
        
        agent = DataCleanAgent(client=client)

        candidates = agent.run(content['content_type'], content["raw_data"], content["image_cleaning_instruction"])
        
        candidates = [c for c in candidates if c['status'] == 'ok']

        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response


@app.route('/api/codex-sort-request', methods=['GET', 'POST'])
def sort_data_request():

    if request.is_json:
        app.logger.info("# sort query: ")
        content = request.get_json()
        token = content["token"]

        client = get_client(content['model'])

        agent = SortDataAgent(client=client)
        candidates = agent.run(content['field'], content['items'])

        #candidates, dialog = limbo_concept.call_codex_sort(content["items"], content["field"])
        candidates = candidates if candidates != None else []
        response = flask.jsonify({ "status": "ok", "token": token, "result": candidates })
    else:
        response = flask.jsonify({ "token": -1, "status": "error", "result": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/derive-data', methods=['GET', 'POST'])
def derive_data():

    if request.is_json:
        app.logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]

        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        new_fields = content["new_fields"]
        instruction = content["extra_prompt"]
        language = content.get("language", "python") # whether to use sql or python, default to python
        
        max_repair_attempts = content["max_repair_attempts"] if "max_repair_attempts" in content else 1

        if "additional_messages" in content:
            prev_messages = content["additional_messages"]
        else:
            prev_messages = []

        logger.info("== input tables ===>")
        for table in input_tables:
            logger.info(f"===> Table: {table['name']} (first 5 rows)")
            logger.info(table['rows'][:5])

        logger.info("== user spec ===")
        logger.info(new_fields)
        logger.info(instruction)

        mode = "transform"
        if len(new_fields) == 0:
            mode = "recommendation"

        conn = db_manager.get_connection(session['session_id']) if language == "sql" else None

        if mode == "recommendation":
            # now it's in recommendation mode
            agent = SQLDataRecAgent(client=client, conn=conn) if language == "sql" else PythonDataRecAgent(client=client)
            results = agent.run(input_tables, instruction)
        else:
            agent = SQLDataTransformationAgent(client=client, conn=conn) if language == "sql" else PythonDataTransformationAgent(client=client)
            results = agent.run(input_tables, instruction, [field['name'] for field in new_fields], prev_messages)

        repair_attempts = 0
        while results[0]['status'] == 'error' and repair_attempts < max_repair_attempts: # try up to n times
            error_message = results[0]['content']
            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."

            prev_dialog = results[0]['dialog']

            if mode == "transform":
                results = agent.followup(input_tables, prev_dialog, [field['name'] for field in new_fields], new_instruction)
            if mode == "recommendation":
                results = agent.followup(input_tables, prev_dialog, new_instruction)

            repair_attempts += 1
        
        if conn:
            conn.close()
        
        response = flask.jsonify({ "token": token, "status": "ok", "results": results })
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": [] })

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response

@app.route('/api/refine-data', methods=['GET', 'POST'])
def refine_data():

    if request.is_json:
        app.logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]


        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        output_fields = content["output_fields"]
        dialog = content["dialog"]
        new_instruction = content["new_instruction"]
        max_repair_attempts = content.get("max_repair_attempts", 1)
        language = content.get("language", "python") # whether to use sql or python, default to python

        logger.info("== input tables ===>")
        for table in input_tables:
            logger.info(f"===> Table: {table['name']} (first 5 rows)")
            logger.info(table['rows'][:5])
        
        logger.info("== user spec ===>")
        logger.info(output_fields)
        logger.info(new_instruction)

        conn = db_manager.get_connection(session['session_id']) if language == "sql" else None

        # always resort to the data transform agent       
        agent = SQLDataTransformationAgent(client=client, conn=conn) if language == "sql" else PythonDataTransformationAgent(client=client)
        results = agent.followup(input_tables, dialog, [field['name'] for field in output_fields], new_instruction)

        repair_attempts = 0
        while results[0]['status'] == 'error' and repair_attempts < max_repair_attempts: # only try once
            error_message = results[0]['content']
            new_instruction = f"We run into the following problem executing the code, please fix it:\n\n{error_message}\n\nPlease think step by step, reflect why the error happens and fix the code so that no more errors would occur."
            prev_dialog = results[0]['dialog']

            results = agent.followup(input_tables, prev_dialog, [field['name'] for field in output_fields], new_instruction)
            repair_attempts += 1

        if conn:
            conn.close()

        response = flask.jsonify({ "token": token, "status": "ok", "results": results})
    else:
        response = flask.jsonify({ "token": "", "status": "error", "results": []})

    response.headers.add('Access-Control-Allow-Origin', '*')
    return response



@app.route('/api/code-expl', methods=['GET', 'POST'])
def request_code_expl():
    if request.is_json:
        app.logger.info("# request data: ")
        content = request.get_json()        
        token = content["token"]

        client = get_client(content['model'])

        # each table is a dict with {"name": xxx, "rows": [...]}
        input_tables = content["input_tables"]
        code = content["code"]
        
        code_expl_agent = CodeExplanationAgent(client=client)
        expl = code_expl_agent.run(input_tables, code)
    else:
        expl = ""
    return expl

@app.route('/api/get-session-id', methods=['GET'])
def get_session_id():
    """Endpoint to get or confirm a session ID from the client"""
    
    # Create session if it doesn't exist
    if 'session_id' not in session:
        session['session_id'] = secrets.token_hex(16)
        session.permanent = True
        logger.info(f"Created new session: {session['session_id']}")
    
    return flask.jsonify({
        "status": "ok",
        "session_id": session['session_id']
    })
    

@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    """Provide frontend configuration settings from environment variables"""
    
    # Create session if it doesn't exist
    if 'session_id' not in session:
        session['session_id'] = secrets.token_hex(16)
        session.permanent = True
        logger.info(f"Created new session: {session['session_id']}")
    
    config = {
        "SHOW_KEYS_ENABLED": os.getenv("SHOW_KEYS_ENABLED", "true").lower() == "true",
        "SESSION_ID": session['session_id']
    }
    return flask.jsonify(config)


@app.route('/api/tables', methods=['GET'])
def list_tables():
    """List all tables in the current session"""
    try:
        result = []
        with db_manager.connection(session['session_id']) as db:
            tables = db.execute("SHOW TABLES").fetchall()
        
            for table in tables:
                table_name = table[0]
                # Get column information
                columns = db.execute(f"DESCRIBE {table_name}").fetchall()
                # Get row count
                row_count = db.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                sample_rows = db.execute(f"SELECT * FROM {table_name} LIMIT 1000").fetchall()

                result.append({
                    "name": table_name,
                    "columns": [{"name": col[0], "type": col[1]} for col in columns],
                    "row_count": row_count,
                    "sample_rows": [dict(zip([col[0] for col in columns], row)) for row in sample_rows]
                })
        
        return jsonify({
            "status": "success",
            "tables": result
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route('/api/tables/sample-table', methods=['POST'])
def sample_table():
    """Sample a table"""
    try:
        data = request.get_json()
        table_id = data.get('table')
        sample_size = data.get('size', 1000)
        projection_fields = data.get('projection_fields', []) # if empty, we want to include all fields
        method = data.get('method', 'random') # one of 'random', 'head', 'bottom'
        order_by_fields = data.get('order_by_fields', [])
        
        # Validate field names against table columns to prevent SQL injection
        with db_manager.connection(session['session_id']) as db:
            # Get valid column names
            columns = [col[0] for col in db.execute(f"DESCRIBE {table_id}").fetchall()]
            
            # Filter order_by_fields to only include valid column names
            valid_order_by_fields = [field for field in order_by_fields if field in columns]
            valid_projection_fields = [field for field in projection_fields if field in columns]

            if len(valid_projection_fields) == 0:
                projection_fields_str = "*"
            else:
                projection_fields_str = ", ".join(valid_projection_fields)

            if method == 'random':
                result = db.execute(f"SELECT {projection_fields_str} FROM {table_id} ORDER BY RANDOM() LIMIT {sample_size}").fetchall()
            elif method == 'head':
                if valid_order_by_fields:
                    # Build ORDER BY clause with validated fields
                    order_by_clause = ", ".join([f'"{field}"' for field in valid_order_by_fields])
                    result = db.execute(f"SELECT {projection_fields_str} FROM {table_id} ORDER BY {order_by_clause} LIMIT {sample_size}").fetchall()
                else:
                    result = db.execute(f"SELECT {projection_fields_str} FROM {table_id} LIMIT {sample_size}").fetchall()
            elif method == 'bottom':
                if valid_order_by_fields:
                    # Build ORDER BY clause with validated fields in descending order
                    order_by_clause = ", ".join([f'"{field}" DESC' for field in valid_order_by_fields])
                    result = db.execute(f"SELECT {projection_fields_str} FROM {table_id} ORDER BY {order_by_clause} LIMIT {sample_size}").fetchall()
                else:
                    result = db.execute(f"SELECT {projection_fields_str} FROM {table_id} ORDER BY ROWID DESC LIMIT {sample_size}").fetchall()

        # When using projection_fields, we need to use those as our column names
        if len(valid_projection_fields) > 0:
            column_names = valid_projection_fields
        else:
            column_names = columns

        return jsonify({
            "status": "success",
            "rows": [dict(zip(column_names, row)) for row in result]
        })
    except Exception as e:
        print(e)
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/tables/get-table', methods=['GET'])
def get_table_data():
    """Get data from a specific table"""
    try:
        with db_manager.connection(session['session_id']) as db:

            table_name = request.args.get('table_name')
            # Get pagination parameters
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 100))
            offset = (page - 1) * page_size
            
            if not table_name:
                return jsonify({
                    "status": "error",
                    "message": "Table name is required"
                }), 400
            
            # Get total count
            total_rows = db.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
            
            # Get paginated data
            result = db.execute(
                f"SELECT * FROM {table_name} LIMIT {page_size} OFFSET {offset}"
            ).fetchall()
            
            # Get column names
            columns = [col[0] for col in db.execute(f"DESCRIBE {table_name}").fetchall()]
            
            # Convert to list of dictionaries
            rows = [dict(zip(columns, row)) for row in result]
        
            return jsonify({
                "status": "success",
                "table_name": table_name,
                "columns": columns,
                "rows": rows,
                "total_rows": total_rows,
                "page": page,
                "page_size": page_size
            })
    
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/tables/create-table', methods=['POST'])
def create_table():
    """Create a new table from uploaded data"""
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "No file provided"}), 400
        
        file = request.files['file']
        table_name = request.form.get('table_name')

        print(f"table_name: {table_name}")
        print(f"file: {file.filename}")
        print(f"file: {file}")
        
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
            
        # Sanitize table name:
        # 1. Convert to lowercase
        # 2. Replace hyphens with underscores
        # 3. Replace spaces with underscores
        # 4. Remove any other special characters
        sanitized_table_name = table_name.lower()
        sanitized_table_name = sanitized_table_name.replace('-', '_')
        sanitized_table_name = sanitized_table_name.replace(' ', '_')
        sanitized_table_name = ''.join(c for c in sanitized_table_name if c.isalnum() or c == '_')
        
        # Ensure table name starts with a letter
        if not sanitized_table_name or not sanitized_table_name[0].isalpha():
            sanitized_table_name = 'table_' + sanitized_table_name
            
        # Verify we have a valid table name after sanitization
        if not sanitized_table_name:
            return jsonify({"status": "error", "message": "Invalid table name"}), 400
            
        with db_manager.connection(session['session_id']) as db:
        
            # Read file based on extension
            if file.filename.endswith('.csv'):
                df = pd.read_csv(file)
            elif file.filename.endswith(('.xlsx', '.xls')):
                df = pd.read_excel(file)
            elif file.filename.endswith('.json'):
                df = pd.read_json(file)
            else:
                return jsonify({"status": "error", "message": "Unsupported file format"}), 400
            
            # Create table
            db.register('df_temp', df)
            db.execute(f"CREATE TABLE {sanitized_table_name} AS SELECT * FROM df_temp")
            db.execute("DROP VIEW df_temp")  # Drop the temporary view after creating the table
            
            return jsonify({
                "status": "success",
                "table_name": sanitized_table_name,
                "row_count": len(df),
                "columns": list(df.columns)
            })
    
    except Exception as e:
        print(e)
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/tables/delete-table', methods=['POST'])
def drop_table():
    """Drop a table"""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
            
        with db_manager.connection(session['session_id']) as db:
            db.execute(f"DROP TABLE IF EXISTS {table_name}")
        
            return jsonify({
                "status": "success",
                "message": f"Table {table_name} dropped"
            })
    
    except Exception as e:
        print(e)
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route('/api/tables/query', methods=['POST'])
def query_table():
    """Execute a query on a table"""
    try:
        data = request.get_json()

        query = data.get('query')

        if not query:
            return jsonify({"status": "error", "message": "No query provided"}), 400
        
        with db_manager.connection(session['session_id']) as db:
            result = db.execute(query).fetch_df()
        
            return jsonify({
                "status": "success",
                "rows": result.to_dict('records'),
                "columns": list(result.columns)
            })
    
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


# Example of a more complex query endpoint
@app.route('/api/tables/analyze', methods=['POST'])
def analyze_table():
    """Get basic statistics about a table"""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400
        
        with db_manager.connection(session['session_id']) as db:
        
            # Get column information
            columns = db.execute(f"DESCRIBE {table_name}").fetchall()
            
            print(f"columns: {columns}")
            stats = []
            for col in columns:
                col_name = col[0]
                col_type = col[1]
                
                # Properly quote column names to avoid SQL keywords issues
                quoted_col_name = f'"{col_name}"'
                
                # Basic stats query
                stats_query = f"""
                SELECT 
                    COUNT(*) as count,
                    COUNT(DISTINCT {quoted_col_name}) as unique_count,
                    COUNT(*) - COUNT({quoted_col_name}) as null_count
                FROM {table_name}
                """
                
                # Add numeric stats if applicable
                if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
                    stats_query = f"""
                    SELECT 
                        COUNT(*) as count,
                        COUNT(DISTINCT {quoted_col_name}) as unique_count,
                        COUNT(*) - COUNT({quoted_col_name}) as null_count,
                        MIN({quoted_col_name}) as min_value,
                        MAX({quoted_col_name}) as max_value,
                        AVG({quoted_col_name}) as avg_value
                    FROM {table_name}
                    """
                
                col_stats = db.execute(stats_query).fetchone()
                
                # Create a dictionary with appropriate keys based on column type
                if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
                    stats_dict = dict(zip(
                        ["count", "unique_count", "null_count", "min", "max", "avg"],
                        col_stats
                    ))
                else:
                    stats_dict = dict(zip(
                        ["count", "unique_count", "null_count"],
                        col_stats
                    ))
                
                stats.append({
                    "column": col_name,
                    "type": col_type,
                    "statistics": stats_dict
                })
        
        return jsonify({
            "status": "success",
            "table_name": table_name,
            "statistics": stats
        })
    
    except Exception as e:
        print(e)
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Data Formulator")
    parser.add_argument("-p", "--port", type=int, default=5000, help="The port number you want to use")
    return parser.parse_args()


def run_app():
    args = parse_args()

    url = "http://localhost:{0}".format(args.port)
    threading.Timer(2, lambda: webbrowser.open(url, new=2)).start()

    app.run(host='0.0.0.0', port=args.port, threaded=True)
    
if __name__ == '__main__':
    #app.run(debug=True, host='127.0.0.1', port=5000)
    #use 0.0.0.0 for public
    run_app()
