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
    Open [http://localhost:3000](http://localhost:3000) to view it in the browser.
    The page will reload if you make edits. You will also see any lint errors in the console.

- **Build for Production**  
    Compile the TypeScript files and bundle the project:
    ```bash
    yarn build
    ```
    This builds the app for production to the `dist` folder.  

    Open [http://localhost:5000](http://localhost:5000) to view it in the browser.

## Usage
See the [Usage section on the README.md page](README.md#usage).
