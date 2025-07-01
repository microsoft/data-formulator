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
from data_formulator.sse_routes import sse_bp

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
    'disable_display_keys': os.environ.get('DISABLE_DISPLAY_KEYS', 'false').lower() == 'true'       
}

# register blueprints
app.register_blueprint(tables_bp)
app.register_blueprint(agent_bp)
app.register_blueprint(sse_bp)

print(APP_ROOT)

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
        "SESSION_ID": session.get('session_id', None)
    }
    return flask.jsonify(config)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Data Formulator")
    parser.add_argument("-p", "--port", type=int, default=5000, help="The port number you want to use")
    parser.add_argument("-e", "--exec-python-in-subprocess", action='store_true', default=False,
        help="Whether to execute python in subprocess, it makes the app more secure (reducing the chance for the model to access the local machine), but increases the time of response")
    parser.add_argument("-d", "--disable-display-keys", action='store_true', default=False,
        help="Whether disable displaying keys in the frontend UI, recommended to turn on if you host the app not just for yourself.")
    parser.add_argument("--dev", action='store_true', default=False,
        help="Launch the app in development mode (prevents the app from opening the browser automatically)")
    return parser.parse_args()


def run_app():
    args = parse_args()
    # Add this line to make args available to routes
    # override the args from the env file
    app.config['CLI_ARGS'] = {
        'exec_python_in_subprocess': args.exec_python_in_subprocess,
        'disable_display_keys': args.disable_display_keys
    }

    if not args.dev:
        url = "http://localhost:{0}".format(args.port)
        threading.Timer(2, lambda: webbrowser.open(url, new=2)).start()

    # Enable debug mode and auto-reload in development mode
    debug_mode = args.dev
    app.run(host='0.0.0.0', port=args.port, threaded=True, debug=debug_mode, use_reloader=debug_mode)

if __name__ == '__main__':
    #app.run(debug=True, host='127.0.0.1', port=5000)
    #use 0.0.0.0 for public
    run_app()
