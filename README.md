<h1 align="center">
  <img src="./public/favicon.ico" alt="Data Formulator icon" width="28">&nbsp;
  Data Formulator: AI-powered Data Visualization
</h1>


<p align="center">
  🪄 Explore data with visualizations, powered by AI agents.
</p>

<p align="center">
  <a href="https://data-formulator.ai"><img src="https://img.shields.io/badge/🚀_Try_Online_Demo-data--formulator.ai-F59E0B?style=for-the-badge" alt="Try Online Demo"></a>
  &nbsp;
  <a href="#get-started"><img src="https://img.shields.io/badge/💻_Install_Locally-uvx_|_pip-3776AB?style=for-the-badge" alt="Install Locally"></a>
</p>

<p align="center">
  <a href="https://pypi.org/project/data_formulator/"><img src="https://img.shields.io/pypi/v/data_formulator.svg?label=pypi%3A%20data_formulator" alt="PyPI"></a>&ensp;
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>&ensp;
  <a href="https://www.youtube.com/watch?v=GfTE2FLyMrs"><img src="https://img.shields.io/badge/YouTube-white?logo=youtube&logoColor=%23FF0000" alt="YouTube"></a>&ensp;
  <a href="https://github.com/microsoft/data-formulator/actions/workflows/python-build.yml"><img src="https://github.com/microsoft/data-formulator/actions/workflows/python-build.yml/badge.svg" alt="build"></a>&ensp;
  <a href="https://discord.gg/mYCZMQKYZb"><img src="https://img.shields.io/badge/discord-chat-green?logo=discord" alt="Discord"></a>
</p>

<!-- [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/data-formulator?quickstart=1) -->
<!-- 
https://github.com/user-attachments/assets/8ca57b68-4d7a-42cb-bcce-43f8b1681ce2 -->


## Why Data Formulator?

Your data lives everywhere — databases, warehouses, BI tools, files. Coding agents can help, but only after someone wires them up, and answers come back as walls of code or text that are hard to follow, refine, or share.

Data Formulator makes it simple: **connect any data, ask anything, get charts you can edit, branch, and share** — all on one interactive, visual canvas.

- **Data & platform teams**: wire up your databases, warehouses, and BI sources once, and give the whole org an AI-powered data exploration layer.
- **Analysts & users**: ask, edit, branch, share. It's so easy to get insights from good-looking charts.

https://github.com/user-attachments/assets/8e4f8a08-6423-4227-a1f7-559e0126ce31

> [!TIP]
> **Love the charts?** They're built on [**Flint**](https://github.com/microsoft/flint-chart) — our open-source visualization language that compiles compact, semantic chart specs into polished Vega-Lite, ECharts, and Chart.js. Explore the [project site](https://microsoft.github.io/flint-chart/) or drop it into your own app.

## News 🔥🔥🔥

[07-23-2026] **Data Formulator 0.8 alpha** (a1–a3, latest: 0.8.0a3) includes:

- **Conversational database loading.** Agents can discover relevant tables, propose filters, preview results, and revise a loading plan through conversation before importing data.
- **Unified Data Thread.** Questions, clarifications, explanations, tables, and charts share one conversation history, with branching from earlier steps into new questions, calculated columns, or visualizations.
- **Expanded chart gallery, powered by Flint.** New bullet, connected scatter, ECDF, Gantt, range area, slope, sparkline, and violin charts, along with improved chart recommendations. Try the open-source [Flint chart language](https://microsoft.github.io/flint-chart/) in your own applications.
- **Persistent analyst attachments.** CSV, JSON, Excel, and other attached files remain available to the analyst throughout an exploration instead of being embedded once in a prompt.
- **Databricks connector.** Browse Unity Catalog catalogs, schemas, and tables, then load Databricks data into the exploration workflow.
- **Microsoft authentication for enterprise connectors.** SQL Server supports passwordless Microsoft Entra ID authentication through `az login`, including an in-app flow for local deployments. Kusto supports delegated Microsoft sign-in alongside Azure default identity and service principal authentication.
- **Connector setup and diagnostics.** Connection forms separate connection, scope, and source-specific authentication options. Persistent server logs and an in-app log viewer help diagnose failures.

> Preview with `pip install --pre data_formulator==0.8.0a3` or `uvx data_formulator@0.8.0a3`.

> Install the latest stable release (0.7) with `pip install data_formulator` or run instantly with `uvx data_formulator`.

## Previous Updates

Here are milestones that lead to the current design:
- **v0.7** (05-28-2026): Turn ANY data into insights in five steps — connect governed data sources, load via agents, explore with the unified `DataAgent` + Data Thread, refine 30+ chart types (semantic chart engine powered by [Flint](https://github.com/microsoft/flint-chart)) with a style-refinement agent, and share as reports. Plus persistent sessions & workspaces and a multilingual (English/Chinese) UI.
- **v0.7 alpha 2** (05-11-2026): Early preview of data connectors, the unified `DataAgent` with thread memory, persistent workspaces, the semantic chart engine, and experimental knowledge distillation.
- **v0.6** ([Demo](https://github.com/microsoft/data-formulator/releases/tag/0.6)): Real-time insights from live data — connect to URLs and databases with automatic refresh
- **uv support**: Faster installation with [uv](https://docs.astral.sh/uv/) — `uvx data_formulator` or `uv pip install data_formulator`
- **v0.5.1** ([Demo](https://github.com/microsoft/data-formulator/pull/200#issue-3635408217)): Community data loaders, US Map & Pie Chart, editable reports, snappier UI
- **v0.5**: Vibe with your data, in control — agent mode, data extraction, reports
- **v0.2.2** ([Demo](https://github.com/microsoft/data-formulator/pull/176)): Goal-driven exploration with agent recommendations and performance improvements
- **v0.2.1.3/4** ([Readme](https://github.com/microsoft/data-formulator/tree/main/py-src/data_formulator/data_loader) | [Demo](https://github.com/microsoft/data-formulator/pull/155)): External data loaders (MySQL, PostgreSQL, MSSQL, Azure Data Explorer, S3, Azure Blob)
- **v0.2** ([Demos](https://github.com/microsoft/data-formulator/releases/tag/0.2)): Large data support with DuckDB integration
- **v0.1.7** ([Demos](https://github.com/microsoft/data-formulator/releases/tag/0.1.7)): Dataset anchoring for cleaner workflows
- **v0.1.6** ([Demo](https://github.com/microsoft/data-formulator/releases/tag/0.1.6)): Multi-table support with automatic joins
- **Model Support**: OpenAI, Azure, Ollama, Anthropic via [LiteLLM](https://github.com/BerriAI/litellm) ([feedback](https://github.com/microsoft/data-formulator/issues/49))
- **Python Package**: Easy local installation ([try it](#get-started))
- **Visualization Challenges**: Test your skills ([challenges](https://github.com/microsoft/data-formulator/issues/53))
- **Data Extraction**: Parse data from images and text ([demo](https://github.com/microsoft/data-formulator/pull/31#issuecomment-2403652717))
- **Initial Release**: [Blog](https://www.microsoft.com/en-us/research/blog/data-formulator-exploring-how-ai-can-help-analysts-create-rich-data-visualizations/) | [Video](https://youtu.be/3ndlwt0Wi3c)

## Overview

**Data Formulator** is a Microsoft Research project for data exploration with visualizations powered by AI agents. It combines *UI interactions* with *natural language* so analysts can communicate intent, branch into alternative analyses, and share results — starting from any data format (screenshot, text, CSV, or database).

## Get Started

Play with Data Formulator with one of the following options. 

- **Option 1: Install via uv (recommended)**
  
  [uv](https://docs.astral.sh/uv/) is an extremely fast Python package manager. If you have uv installed, you can run Data Formulator directly without any setup:
  
  ```bash
  uvx data_formulator
  ```

  Run `uvx data_formulator --help` to see all available options, such as custom port, sandboxing mode, and data storage location.

- **Option 2: Install via pip**
  
  Use pip for installation (recommend: install it in a virtual environment).
  
  ```bash
  pip install data_formulator # install
  python -m data_formulator # run
  ```

  Data Formulator will be automatically opened in the browser at [http://localhost:5567](http://localhost:5567).

- **Option 3: Run with Docker**

  ```bash
  docker compose up --build
  ```

  Open [http://localhost:5567](http://localhost:5567) in your browser. To stop, press `Ctrl+C` or run `docker compose down`.

- **Option 4: Codespaces**

  You can run Data Formulator in Codespaces; we have everything pre-configured. For more details, see [CODESPACES.md](CODESPACES.md).
  
  [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/data-formulator?quickstart=1)


- **Option 5: Working as developer**
  
  You can build Data Formulator locally and develop your own version. Check out details in [DEVELOPMENT.md](DEVELOPMENT.md).


## Using Data Formulator

Besides uploading csv, tsv or xlsx files that contain structured data, you can ask Data Formulator to extract data from screenshots, text blocks or websites, or load data from databases use connectors. Then you are ready to explore. Ask visualizaiton questions, edit charts, or delegate some exploration tasks to agents. Then, create reports to share your insights.

https://github.com/user-attachments/assets/164aff58-9f93-4792-b8ed-9944578fbb72

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
