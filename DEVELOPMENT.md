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


## Usage
See the [Usage section on the README.md page](README.md#usage).
