# Data Formulator

Transform data and create rich visualizations iteratively with an AI agent.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/data-formulator?quickstart=1)
  
![Hero image](https://github.com/user-attachments/assets/18069024-f721-463a-b6a1-bd6ec0a3857c)

## Overview

**Data Formulator** is an application from Microsoft Research that uses large language models to transform data, expediting the practice of data visualization.

With most modern visualization tools, authors need to transform their data into tidy formats to create visualizations they want. Because this requires experience with programming or separate data processing tools, data transformation remains a barrier in visualization authoring. To address this challenge, we present a new visualization paradigm, concept binding, that separates high-level visualization intents and low-level data transformation steps, leveraging an AI agent. 

With Data Formulator, authors first define data concepts they plan to visualize using natural languages or examples, and then bind them to visual channels. Data Formulator then dispatches its AI-agent to automatically transform the input data to surface these concepts and generate desired visualizations. When presenting the results (transformed table and output visualizations) from the AI agent, Data Formulator provides feedback to help authors inspect and understand them. A user study with 10 participants shows that participants could learn and use Data Formulator to create visualizations that involve challenging data transformations, and presents interesting future research directions.

## References
* [Data Formulator on Microsoft Research Blog](https://www.microsoft.com/en-us/research/blog/data-formulator-a-concept-driven-ai-powered-approach-to-data-visualization/?msockid=0c9345563fe06aec100c54e93e8f6b47)
* [Data Formulator Microsoft Research publication](https://www.microsoft.com/en-us/research/publication/data-formulator-ai-powered-concept-driven-visualization-authoring/)
* [ArXiv paper](https://arxiv.org/abs/2309.10094) - presented at [VIS 2023](https://ieeevis.org/year/2023/welcome) and winner of the [Best Paper Honorable Mention](https://ieeevis.org/year/2023/info/awards/best-paper-awards) award

## Get Started

Choose one of the following options to set up Data Formulator:

- **Option 1: Codespaces**
  
  Use Codespaces for an easy setup experience, as everything is preconfigured to get you up and running quickly. For more details, see [CODESPACES.md](CODESPACES.md).
  
  [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/data-formulator?quickstart=1)

- **Option 2: Local Installation**
  
  Opt for a local installation if you prefer full control over your development environment and the ability to customize the setup to your specific needs. For detailed instructions, refer to [DEVELOPMENT.md](DEVELOPMENT.md).


## Usage

Once you’ve completed the setup using either option, follow these steps to start using Data Formulator:

### The basics of data visualization
* Choose a dataset
* Choose a visualization
* Add data fields to your visualization

### Add the special sauce 
* Create new concepts and click the **Formulate** button
* Inspect the code behind the concept
* Add the new concept fields to your visualization

Repeat this process as needed to explore and understand your data. Your explorations are trackable in the **Data Threads** panel. 

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
