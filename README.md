# Data Formulator

Data Formulator --- transforming data and create rich visualizations iteratively with an AI agent.

## Get Started

To run Data Formulator locally, you need to (1) set up the python server and (2) build the front-end web client.

### Install

1. setup python server:

```
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

2. setup web client

```
yarn install
yarn build
```

Install dependencies and build the front-end web app for production to the `build` folder.

### Run Data Formulator

Start the python server with one of the following scripts:

Windows:
```
.\local_server.bat
```

Unix-based:
```
.\local_server.sh
```

Open [http://localhost:5000](http://localhost:5000) to view it in the browser.


### Front-end development

If you want to work with Data Formulator front-end, you can run the app in the development with

```yarn start```

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

If you want to deploy your updated front-end, run ```yarn build```.

This builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

Follow steps from `Run Data Formulator` to play with your built.


## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
