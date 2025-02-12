import streamlit as st
import subprocess
import os
from pathlib import Path
import threading
import time
from streamlit.components.v1 import html
from py_src.data_formulator.app import create_app
from flask import Flask

# Initialize session state
if 'server_thread' not in st.session_state:
    st.session_state.server_thread = None
    st.session_state.server_running = False

def run_vite_build():
    """Build the React frontend"""
    subprocess.run(["npm", "run", "build"], check=True)

def run_flask_server():
    """Run the Flask server in a separate thread"""
    app = create_app()
    app.run(port=5000)

def start_server():
    """Start the Flask server in a background thread"""
    if not st.session_state.server_running:
        server_thread = threading.Thread(target=run_flask_server, daemon=True)
        server_thread.start()
        st.session_state.server_thread = server_thread
        st.session_state.server_running = True
        time.sleep(2)  # Give the server time to start

def main():
    st.title("Data Formulator")
    
    # API Key input in sidebar
    api_key = st.sidebar.text_input("OpenAI API Key", type="password")
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
    
    if not api_key:
        st.warning("Please enter your OpenAI API key in the sidebar to begin.")
        return

    # Start the Flask server if not already running
    if not st.session_state.server_running:
        with st.spinner("Starting server..."):
            start_server()
    
    # Embed the React frontend
    html_content = """
    <div style="width: 100%; height: 800px;">
        <iframe src="http://localhost:5000" width="100%" height="100%" frameborder="0"></iframe>
    </div>
    """
    html(html_content, height=800)

if __name__ == "__main__":
    main()
