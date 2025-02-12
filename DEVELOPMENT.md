# Set up a local Data Formulator development environment
How to set up your local machine.

## Prerequisites
* Python > 3.11
* Node.js
* Yarn

## Backend (Python)

- **Create a Virtual Environment**  
    ```bash
    python -m venv venv
    .\venv\Scripts\activate
    ```

- **Install Dependencies**  
    ```bash
    pip install -r requirements.txt
    ```

- **Run**
    - **Windows**
    ```bash
    .\local_server.bat
    ```

    - **Unix-based**
    ```bash
    .\local_server.sh
    ```

## Frontend (TypeScript)

- **Install NPM packages**  
    
    ```bash
    yarn
    ```

- **Development mode**

    Run the front-end in development mode using, allowing real-time edits and previews:
    ```bash
    yarn start
    ```
    Open [http://localhost:5173](http://localhost:5173) to view it in the browser.
    The page will reload if you make edits. You will also see any lint errors in the console.

## Build for Production

- **Build the frontend and then the backend**

    Compile the TypeScript files and bundle the project:
    ```bash
    yarn build
    ```
    This builds the app for production to the `py-src/data_formulator/dist` folder.  

    Then, build python package:

    ```bash
    pip install build
    python -m build
    ```
    This will create a python wheel in the `dist/` folder. The name would be `data_formulator-<version>-py3-none-any.whl`

- **Test the artifact**

    You can then install the build result wheel (testing in a virtual environment is recommended):
    ```bash
    # replace <version> with the actual build version. 
    pip install dist/data_formulator-<version>-py3-none-any.whl 
    ```

    Once installed, you can run Data Formulator with:
    ```bash
    data_formulator
    ```
    or 
    ```bash
    python -m data_formulator
    ```

    Open [http://localhost:5000](http://localhost:5000) to view it in the browser.

## Third-Party LLM Endpoints

To use third-party LLM endpoints, such as Ollama, follow these steps:

1. **Set Environment Variables**  
    Set the following environment variables to configure the third-party LLM endpoint:
    ```bash
    export LLM_ENDPOINT="http://localhost:11434"  # Example for Ollama
    export LLM_MODEL="llama2"  # Default model
    export LLM_API_KEY=""  # API key if required
    ```

2. **Update `client_utils.py`**  
    Ensure that the `get_client` function in `py-src/data_formulator/agents/client_utils.py` is updated to handle third-party LLM endpoints using LiteLLM.

3. **Frontend Configuration**  
    Update the frontend UI in `src/views/ModelSelectionDialog.tsx` to provide options for third-party LLM endpoints.

## Usage
See the [Usage section on the README.md page](README.md#usage).
