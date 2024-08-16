## Development


### Backend (Python)

- **Development Setup:**
  - **Create a Virtual Environment:**  
    Use Python's `venv` module to create and activate a virtual environment to isolate package installations.
  - **Install Dependencies:**  
    Install all required Python packages from the `requirements.txt` file.

- **Running Locally:**
  - **Start the Server:**  
    Use provided scripts to run the server on Windows or Unix-based systems.
  - **Open Localhost:**  
    Access the application by navigating to `http://localhost:5000` in a web browser.

### Frontend (TypeScript)

- **Environment Setup:**
  - **Install Node.js:**  
    Ensure Node.js is installed on your machine to use packages like `yarn`.
  - **Install Yarn:**  
    Use `yarn` to handle dependencies and scripts.

- **Development:**
  - **Start Development Server:**  
    Run the front-end in development mode using `yarn start`, allowing real-time edits and previews.  
    - **Run Data Formulator:**  
      If you want to work on the Data Formulator front-end, run the app in development mode with:
      ```bash
      yarn start
      ```
      This will run the app in development mode.  
      Open [http://localhost:3000](http://localhost:3000) to view it in the browser.
      The page will reload if you make edits.  
      You will also see any lint errors in the console.

  - **Build for Production:**  
    Compile the TypeScript files and bundle the project for production using `yarn build`.
    - **Deploy Data Formulator:**  
      If you want to deploy your updated front-end, run:
      ```bash
      yarn build
      ```
      This builds the app for production to the `build` folder.  
      It correctly bundles React in production mode and optimizes the build for the best performance.  
      Follow the steps from **Run Data Formulator** to work with your built version.


  - **Install Python Server:**
    
    Setup a virtual environment:
      ```bash
      python -m venv venv
      .\venv\Scripts\activate
      pip install -r requirements.txt
      ```

  - **Install Web Client:**
    
    Install dependencies and build the front-end web app:
      ```bash
      yarn install
      yarn build
      ```

      This will build the web app for production into the `build` folder.

  - **Run Data Formulator:**

    Start the Python server with one of the following scripts:

      - **Windows:**
        ```bash
        .\local_server.bat
        ```

      - **Unix-based:**
        ```bash
        .\local_server.sh
        ```

    - Open [http://localhost:5000](http://localhost:5000) to view it in the browser.
