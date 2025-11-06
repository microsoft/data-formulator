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
- **Configure environment variable (optional)s**
    - copy `api-keys.env.example` to `api-keys.env` and add your API keys.
        - required fields for different providers are different, please refer to the [LiteLLM setup](https://docs.litellm.ai/docs#litellm-python-sdk) guide for more details.
            - currently only endpoint, model, api_key, api_base, api_version are supported.
        - this helps data formulator to automatically load the API keys when you run the app, so you don't need to set the API keys in the app UI.

    - set `.env` to configure server properties:
        - copy `.env.template` to `.env`
        - configure settings as needed:
            - DISABLE_DISPLAY_KEYS: if true, API keys will not be shown in the frontend
            - EXEC_PYTHON_IN_SUBPROCESS: if true, Python code runs in a subprocess (safer but slower), you may consider setting it true when you are hosting Data Formulator for others
            - LOCAL_DB_DIR: directory to store the local database (uses temp directory if not set)
            - External database settings (when USE_EXTERNAL_DB=true):
                - DB_NAME: name to refer to this database connection
                - DB_TYPE: mysql or postgresql (currently only these two are supported)
                - DB_HOST: database host address
                - DB_PORT: database port
                - DB_DATABASE: database name
                - DB_USER: database username
                - DB_PASSWORD: database password


- **Run the app**
    - **Windows**
    ```bash
    .\local_server.bat
    ```

    - **Unix-based**
    ```bash
    ./local_server.sh
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


## Security Considerations for Production Deployment

⚠️ **IMPORTANT SECURITY WARNING FOR PRODUCTION DEPLOYMENT**

When deploying Data Formulator to production, please be aware of the following security considerations:

### Database Storage Security

1. **Local DuckDB Files**: When database functionality is enabled (default), Data Formulator stores DuckDB database files locally on the server. These files contain user data and are stored in the system's temporary directory or a configured `LOCAL_DB_DIR`.

2. **Session Management**: 
   - When database is **enabled**: Session IDs are stored in Flask sessions (cookies) and linked to local DuckDB files
   - When database is **disabled**: No persistent storage is used, and no cookies are set. Session IDs are generated per request for API consistency

3. **Data Persistence**: User data processed through Data Formulator may be temporarily stored in these local DuckDB files, which could be a security risk in multi-tenant environments.

### Recommended Security Measures

For production deployment, consider:

1. **Use `--disable-database` flag** for stateless deployments where no data persistence is needed
2. **Implement proper authentication, authorization, and other security measures** as needed for your specific use case, for example:
   - Store DuckDB file in a database
   - User authentication (OAuth, JWT tokens, etc.)
   - Role-based access control
   - API rate limiting
   - HTTPS/TLS encryption
   - Input validation and sanitization 

### Configuration for Production

```bash
# For stateless deployment (recommended for public hosting)
python -m data_formulator.app --disable-database
```

## Usage
See the [Usage section on the README.md page](README.md#usage).
