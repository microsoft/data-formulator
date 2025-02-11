# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
from litellm import completion
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

def get_client(endpoint, key=None, model_name=None):
    """
    Returns a LiteLLM client configured for the specified endpoint and model.
    Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
    """
    # Set default endpoint 
    endpoint = os.getenv("ENDPOINT", endpoint) if endpoint == "default" else endpoint

    if model_name is None:
        if endpoint == "openai":
            model_name = "gpt-4"  # Default 
        elif "azure" in endpoint.lower():
            model_name = "azure-gpt-4"  
        elif "ollama" in endpoint.lower():
            model_name = "llama2"  
        else:
            model_name = ""  

    # Configure LiteLLM 
    if endpoint == "openai":
        return completion(
            model=model_name,
            api_key=key,
            custom_llm_provider="openai"
        )
    elif "azure" in endpoint.lower():
        if key is None or key == "":
            token_provider = get_bearer_token_provider(
                DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
            )
            return completion(
                model=model_name,
                api_base=endpoint,
                api_version="2024-02-15-preview",
                azure_ad_token_provider=token_provider,
                custom_llm_provider="azure"
            )
        else:
            return completion(
                model=model_name,
                api_base=endpoint,
                api_key=key,
                api_version="2024-02-15-preview",
                custom_llm_provider="azure"
            )
    elif "ollama" in endpoint.lower():
        return completion(
            model=f"ollama/{model_name}",  
            api_base=endpoint,
            custom_llm_provider="ollama"
        )
    else:
        return completion(
            model=model_name,
            api_base=endpoint,
            api_key=key
        )
