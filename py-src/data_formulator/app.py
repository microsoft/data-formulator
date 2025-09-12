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
from flask import Flask, request, send_from_directory, session
from flask import stream_with_context, Response

import webbrowser
import threading
import numpy as np
import datetime
import time

import logging

import json
from pathlib import Path

from vega_datasets import data as vega_data

from dotenv import load_dotenv
import secrets
import base64
APP_ROOT = Path(Path(__file__).parent).absolute()

import os

# blueprints
from data_formulator.tables_routes import tables_bp
from data_formulator.agent_routes import agent_bp
from data_formulator.db_manager import db_manager

import queue
from typing import Dict, Any

app = Flask(__name__, static_url_path='', static_folder=os.path.join(APP_ROOT, "dist"))
app.secret_key = secrets.token_hex(16)  # Generate a random secret key for sessions

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.int64):
            return int(obj)
        if isinstance(obj, (bytes, bytearray)):
            return base64.b64encode(obj).decode('ascii')
        return super().default(obj)

app.json_encoder = CustomJSONEncoder

# Load env files early
load_dotenv(os.path.join(APP_ROOT, "..", "..", 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, '.env'))

# Add this line to store args at app level
app.config['CLI_ARGS'] = {
    'exec_python_in_subprocess': os.environ.get('EXEC_PYTHON_IN_SUBPROCESS', 'false').lower() == 'true',
    'disable_display_keys': os.environ.get('DISABLE_DISPLAY_KEYS', 'false').lower() == 'true',
    'disable_database': os.environ.get('DISABLE_DATABASE', 'false').lower() == 'true'       
}

# register blueprints
# Only register tables blueprint if database is not disabled
if not app.config['CLI_ARGS']['disable_database']:
    app.register_blueprint(tables_bp)
app.register_blueprint(agent_bp)

# Get logger for this module (logging config moved to run_app function)
logger = logging.getLogger(__name__)

def configure_logging():
    """Configure logging for the Flask application."""
    # Configure root logger for general application logging
    logging.basicConfig(
        level=logging.ERROR,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Suppress verbose logging from third-party libraries
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('litellm').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)
    
    # Configure Flask app logger to use the same settings
    app.logger.handlers = []
    for handler in logging.getLogger().handlers:
        app.logger.addHandler(handler)

@app.route('/api/vega-datasets')
def get_example_dataset_list():
    example_datasets = [
        {"name": "gapminder", 
         "description": "A simplified dataset of global development indicators tracking population, and life expectancy across countries over time.",
         "challenges": [
            {"text": "Show life expectancy trends for the 5 most populous countries.", "difficulty": "easy", "goal": "Life expectancy trends of the world's largest countries"},
            {"text": "Which countries experienced the most dramatic life expectancy improvements between 1955 and 2005? Show the top 10 countries with the largest percentage increase.", "difficulty": "easy", "goal": "Countries with fastest life expectancy growth over 50 years"},
            {"text": "Show the relationship between fertility rate and life expectancy in 2005. Highlight countries with population over 100 million.", "difficulty": "easy", "goal": "Fertility vs life expectancy correlation in major countries"},
            {"text": "Identify countries that consistently ranked in the top 10 for life expectancy across all decades (1955-2005). Visualize their life expectancy trends over time.", "difficulty": "hard", "goal": "Consistently high-performing countries in life expectancy"},
            {"text": "Find countries that completed the demographic transition (high life expectancy, low fertility) most quickly. Calculate the speed of transition for each country and show the top 15 fastest transitions.", "difficulty": "hard", "goal": "Speed of demographic transition across countries"}
        ]},
        {"name": "income", 
         "description": "US income distribution data showing how household incomes are spread across different brackets and states.",
         "challenges": [
            {"text": "Compare income distribution between California and Texas over groups.", "difficulty": "easy", "goal": "Income distribution comparison: California vs Texas"},
            {"text": "Which states showed the most volatile income distribution changes between 2000-2016? Calculate the standard deviation of income group percentages for each state.", "difficulty": "easy", "goal": "States with most volatile income distribution changes"},
            {"text": "Create a stacked bar chart showing how the middle class (middle income groups) has changed as a percentage of total population across all states over time.", "difficulty": "easy", "goal": "Middle class evolution across US states"},
            {"text": "Identify states that experienced a 'middle class squeeze' - where middle income groups decreased while both low and high income groups increased. Visualize these trends.", "difficulty": "hard", "goal": "States experiencing middle class decline"},
            {"text": "Calculate the Gini coefficient equivalent for each state in 2016 using income group data. Show the 10 states with highest and lowest income inequality.", "difficulty": "hard", "goal": "Income inequality ranking across US states"}
        ]},
        {"name": "disasters", 
         "description": "Historical records of natural disasters worldwide, including fatalities, types, and locations.",
         "challenges": [
            {"text": "Show deaths by disaster type for the last 10 years.", "difficulty": "easy", "goal": "Fatalities by disaster type (recent decade)"},
            {"text": "Which disaster types have become more or less deadly over time? Calculate the 10-year moving average of deaths for each disaster type.", "difficulty": "easy", "goal": "Long-term trends in disaster fatality rates"},
            {"text": "Create a heatmap showing the correlation between different disaster types - which disasters tend to occur together in the same year?", "difficulty": "easy", "goal": "Correlation patterns between disaster types"},
            {"text": "Identify years with 'disaster clusters' - when multiple disaster types had above-average death tolls. Visualize these high-impact years.", "difficulty": "hard", "goal": "Years with multiple high-impact disasters"}
        ]},
        {"name": "movies", 
         "description": "Box office performance, budgets, and ratings for films across different genres and time periods.",
         "challenges": [
            {"text": "Show the top 20 highest-grossing movies by genre.", "difficulty": "easy", "goal": "Top-grossing movies across genres"},
            {"text": "Which movie genres have the highest 'return on investment' (worldwide gross / production budget)? Show the top 10 genres by average ROI.", "difficulty": "easy", "goal": "Most profitable movie genres by ROI"},
            {"text": "Create a scatter plot of budget vs worldwide gross, colored by genre. Highlight movies that overperformed relative to their budget.", "difficulty": "easy", "goal": "Budget vs gross performance by genre"},
            {"text": "Identify 'sleeper hits' - movies with low budgets but high ratings and gross. Show the top 20 movies that exceeded expectations.", "difficulty": "hard", "goal": "Low-budget movies that exceeded expectations"},
            {"text": "Calculate the 'critical-commercial success' score (normalized rating × normalized gross) for each movie. Visualize how this score varies by genre and decade.", "difficulty": "hard", "goal": "Critical and commercial success by genre and era"}
        ]},
        {"name": "unemployment-across-industries", 
         "description": "Unemployment rates across different economic sectors and industries over time.",
         "challenges": [
            {"text": "Show unemployment trends for the 5 largest industries.", "difficulty": "easy", "goal": "Unemployment trends in major industries"},
            {"text": "Which industries are most sensitive to economic cycles? Calculate the correlation between each industry's unemployment rate and the overall average.", "difficulty": "easy", "goal": "Economic cycle sensitivity by industry"},
            {"text": "Create a line chart showing the 'unemployment gap' (industry rate minus overall average) for each industry over time. Highlight industries that consistently outperform or underperform.", "difficulty": "easy", "goal": "Industry performance relative to overall unemployment"},
            {"text": "Identify 'recession-proof' industries - those with the smallest unemployment rate increases during economic downturns (2000-2003, 2008-2010).", "difficulty": "hard", "goal": "Industries resilient to economic downturns"},
            {"text": "Calculate the 'volatility index' (standard deviation of unemployment rate) for each industry. Show which industries have the most stable vs volatile employment patterns.", "difficulty": "hard", "goal": "Employment stability ranking across industries"}
        ]}
    ]
    dataset_info = []
    for dataset in example_datasets:
        name = dataset["name"]
        description = dataset["description"]
        challenges = dataset["challenges"]
        try:
            info_obj = {'name': name, 'description': description, 'challenges': challenges, 'snapshot': vega_data(name).to_json(orient='records')}
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
        data_object = "[]"
    response = data_object
    return response

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

@app.route('/api/get-session-id', methods=['GET', 'POST'])
def get_session_id():
    """Endpoint to get or confirm a session ID from the client"""
    # if it is a POST request, we expect a session_id in the body
    # if it is a GET request, we do not expect a session_id in the query params
    
    current_session_id = None
    if request.is_json:
        content = request.get_json()
        current_session_id = content.get("session_id", None)
        
    # Create session if it doesn't exist
    if current_session_id is None:    
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session.permanent = True
            logger.info(f"Created new session: {session['session_id']}")
    else:
        # override the session_id
        session['session_id'] = current_session_id
        session.permanent = True 
    
    return flask.jsonify({
        "status": "ok",
        "session_id": session['session_id']
    })

@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    """Provide frontend configuration settings from CLI arguments"""
    args = app.config['CLI_ARGS']
    config = {
        "EXEC_PYTHON_IN_SUBPROCESS": args['exec_python_in_subprocess'],
        "DISABLE_DISPLAY_KEYS": args['disable_display_keys'],
        "DISABLE_DATABASE": args['disable_database'],
        "SESSION_ID": session.get('session_id', None)
    }
    return flask.jsonify(config)

@app.route('/api/tables/<path:path>', methods=['GET', 'POST'])
def database_disabled_fallback(path):
    """Fallback route for table endpoints when database is disabled"""
    if app.config['CLI_ARGS']['disable_database']:
        return flask.jsonify({
            "status": "error",
            "message": "Database functionality is disabled. Use --disable-database=false to enable table operations."
        }), 503
    else:
        # If database is not disabled but we're hitting this route, it means the tables blueprint wasn't registered
        return flask.jsonify({
            "status": "error", 
            "message": "Table routes are not available"
        }), 404


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Data Formulator")
    parser.add_argument("-p", "--port", type=int, default=5000, help="The port number you want to use")
    parser.add_argument("--exec-python-in-subprocess", action='store_true', default=False,
        help="Whether to execute python in subprocess, it makes the app more secure (reducing the chance for the model to access the local machine), but increases the time of response")
    parser.add_argument("--disable-display-keys", action='store_true', default=False,
        help="Whether disable displaying keys in the frontend UI, recommended to turn on if you host the app not just for yourself.")
    parser.add_argument("--disable-database", action='store_true', default=False,
        help="Disable database functionality and table routes. This prevents creation of local database files and disables table-related endpoints.")
    parser.add_argument("--dev", action='store_true', default=False,
        help="Launch the app in development mode (prevents the app from opening the browser automatically)")
    return parser.parse_args()


def run_app():
    # Configure logging only when actually running the app
    configure_logging()
    
    args = parse_args()
    # Add this line to make args available to routes
    # override the args from the env file
    app.config['CLI_ARGS'] = {
        'exec_python_in_subprocess': args.exec_python_in_subprocess,
        'disable_display_keys': args.disable_display_keys,
        'disable_database': args.disable_database
    }
    
    # Update database manager state
    db_manager._disabled = args.disable_database

    if not args.dev:
        url = "http://localhost:{0}".format(args.port)
        threading.Timer(2, lambda: webbrowser.open(url, new=2)).start()

    # Enable debug mode and auto-reload in development mode
    debug_mode = args.dev
    app.run(host='0.0.0.0', port=args.port, debug=debug_mode, use_reloader=debug_mode)

if __name__ == '__main__':
    #app.run(debug=True, host='127.0.0.1', port=5000)
    #use 0.0.0.0 for public
    run_app()
