# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import openai
import os
import sys

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from litellm import completion  # Import LiteLLM

def get_client(endpoint, key):

    endpoint = os.getenv("ENDPOINT") if endpoint == "default" else endpoint

    if key is None or key == "":
        # using azure keyless access method
        token_provider = get_bearer_token_provider(
            DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
        )
        print(token_provider)
        print(endpoint)
        client = openai.AzureOpenAI(
            api_version="2024-02-15-preview",
            azure_endpoint=endpoint,
            azure_ad_token_provider=token_provider
        )
    elif endpoint == 'openai':
        client = openai.OpenAI(api_key=key)
    elif "ollama" in endpoint.lower():
        model = os.getenv("LLM_MODEL", "llama2")
        client = completion(
            model=f"ollama/{model}",
            api_base=endpoint,
            api_key=key,
            custom_llm_provider="ollama"
        )
    else:
        client = openai.AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=key,
            api_version="2024-02-15-preview"
        )
    return client
