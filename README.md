# Data Formulator

Transform data and create rich visualizations iteratively with an AI agent.

  
![Hero image](https://github.com/user-attachments/assets/18069024-f721-463a-b6a1-bd6ec0a3857c)

## Overview

**Data Formulator** is a charting application from Microsoft Research that uses large language models to tidy up data, expediting the practice of data visualization.

With most modern visualization tools, authors need to transform their data into tidy formats to create visualizations they want. Because this requires experience with programming or separate data processing tools, data transformation remains a barrier in visualization authoring. To address this challenge, we present a new visualization paradigm, concept binding, that separates high-level visualization intents and low-level data transformation steps, leveraging an AI agent. 

With Data Formulator, authors first define data concepts they plan to visualize using natural languages or examples, and then bind them to visual channels. Data Formulator then dispatches its AI-agent to automatically transform the input data to surface these concepts and generate desired visualizations. When presenting the results (transformed table and output visualizations) from the AI agent, Data Formulator provides feedback to help authors inspect and understand them. A user study with 10 participants shows that participants could learn and use Data Formulator to create visualizations that involve challenging data transformations, and presents interesting future research directions.

## References
* [Data Formulator on Microsoft Research Blog](https://www.microsoft.com/en-us/research/blog/data-formulator-a-concept-driven-ai-powered-approach-to-data-visualization/?msockid=0c9345563fe06aec100c54e93e8f6b47)
* [Data Formulator Microsoft Research publication](https://www.microsoft.com/en-us/research/publication/data-formulator-ai-powered-concept-driven-visualization-authoring/)
* [ArXiv paper](https://arxiv.org/abs/2309.10094) - presented at [VIS 2023](https://ieeevis.org/year/2023/welcome) and winner of the [Best Paper Honorable Mention](https://ieeevis.org/year/2023/info/awards/best-paper-awards) award



## Get Started

Choose one of the following options to set up Data Formulator:

- **Option 1: Codespaces**
  - **Open Codespaces**  
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus nec lacinia nisi.
  - **Create a New Codespace**  
    Nulla facilisi. Cras at ligula vel sapien venenatis scelerisque.
  - **Clone the Repository**  
    Donec ut metus finibus, venenatis eros sed, fringilla turpis.
  - **Launch the Application**  
    Fusce quis sapien ut purus dapibus tempor. Integer euismod metus in eros ultricies.

- **Option 2: Local Installation**

  - **Install Python Server:**
    - Setup a virtual environment:
      ```bash
      python -m venv venv
      .\venv\Scripts\activate
      pip install -r requirements.txt
      ```

  - **Install Web Client:**
    - Install dependencies and build the front-end web app:
      ```bash
      yarn install
      yarn build
      ```

      This will build the web app for production into the `build` folder.

  - **Run Data Formulator:**
    - Start the Python server with one of the following scripts:

      - **Windows:**
        ```bash
        .\local_server.bat
        ```

      - **Unix-based:**
        ```bash
        .\local_server.sh
        ```

    - Open [http://localhost:5000](http://localhost:5000) to view it in the browser.

## Follow-Up Steps

Once you’ve completed the setup using either option, follow these steps to start using Data Formulator:

- **Step 1:** Lorem ipsum dolor sit amet, consectetur adipiscing elit.
- **Step 2:** Vivamus nec lacinia nisi. Cras at ligula vel sapien.
- **Step 3:** Fusce quis sapien ut purus dapibus tempor.

## Development

If you want to work on the Data Formulator front-end, you can run the app in development mode with:

```bash
yarn start
```

This will run the app in development mode.  
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.  
You will also see any lint errors in the console.

If you want to deploy your updated front-end, run:

```bash
yarn build
```

This builds the app for production to the `build` folder.  
It correctly bundles React in production mode and optimizes the build for the best performance.

Follow the steps from **Run Data Formulator** to work with your built version.

## Credits
Data Formulator was developed at Microsoft Research by these team members:
* [Chenglong Wang](https://www.microsoft.com/en-us/research/people/chenwang/)
* [Bongshin Lee](https://www.bongshiny.com/)
* [John Thompson](https://jrthomp.com/)
* [Steven Drucker](https://www.microsoft.com/en-us/research/people/sdrucker/)
* [Jianfeng Gao](https://www.microsoft.com/en-us/research/people/jfgao/)
* [Dan Marshall](https://www.microsoft.com/en-us/research/people/danmar/)

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
