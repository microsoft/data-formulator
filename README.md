<h1>
    <img src="./public/favicon.ico" alt="Data Formulator icon" width="28"> <b>Data Formulator</b>
</h1>

Transform data and create rich visualizations iteratively with AI 🪄.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/data-formulator?quickstart=1)

<kbd>
  <img src="public/data-formulator-screenshot.png">
</kbd>

## Overview

**Data Formulator** is an application from Microsoft Research that uses large language models to transform data, expediting the practice of data visualization.

To create rich visualizations, data analysts often need to iterate back and forth among data processing and chart specification to achieve their goals. To achieve this, analysts need  proficiency in data transformation and visualization tools, and they also need spending efforts managing the iteration history. This can be challenging!

Data Formualtor is an AI-powered tool for analysts to iteratively create rich visualiztaions. Different from most chat-based AI tools where users need to describe everything in natural language, Data Formulator combines user interface interactions (UI) with natural language (NL) inputs. This blended approach makes it easier for users to describe their chart designs while delegating data transformation to AI. 

Check out these cool Data Formulator features that can help you create impressive visualizations!
* Using the **blended UI and NL inputs** to describe the chart. 
* Utilizing **data threads** to navigate the history and reuse previous results to create new ones instead of starting from scratch every time.

## References
* [Data Formulator on Microsoft Research Blog]()
* [Data Formulator v2 paper]()
* [Data Formulator v1 paper](https://arxiv.org/abs/2309.10094)

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
* Choose a visualization type
* Drag and drop data fields to the encoding shelf to create visualization

### Create visualization beyond the initial dataset (powered by 🤖)
* Add new field names in the encoding shelf, describe the chart intent
* Click the **Formulate** button
* Inspect the code behind the concept
* Follow up the chart to create new ones

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
