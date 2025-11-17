import litellm
import openai
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from typing import Dict, Optional, Union

class OpenAIClientAdapter(object):
    """
    Wrapper around OpenAI or AzureOpenAI client that provides the same interface as Client.
    """
    def __init__(self, openai_client: Union[openai.OpenAI, openai.AzureOpenAI], model: str):
        self._openai_client = openai_client
        self.model = model
        self.params = {}
        
    def get_completion(self, messages):
        """
        Returns a completion using the wrapped OpenAI client.
        """
        completion_params = {
            "model": self.model,
            "messages": messages,
        }
        
        return self._openai_client.chat.completions.create(**completion_params)

class Client(object):
    """
    Returns a LiteLLM client configured for the specified endpoint and model.
    Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
    """
    def __init__(self, endpoint, model, api_key=None,  api_base=None, api_version=None):
        
        self.endpoint = endpoint
        self.model = model
        self.params = {}

        if api_key is not None and api_key != "":
            self.params["api_key"] = api_key
        if api_base is not None and api_base != "":
            self.params["api_base"] = api_base
        if api_version is not None and api_version != "":
            self.params["api_version"] = api_version

        if self.endpoint == "gemini":
            if model.startswith("gemini/"):
                self.model = model
            else:
                self.model = f"gemini/{model}"
        elif self.endpoint == "anthropic":
            if model.startswith("anthropic/"):
                self.model = model
            else:
                self.model = f"anthropic/{model}"
        elif self.endpoint == "azure":
            self.params["api_base"] = api_base
            self.params["api_version"] = api_version if api_version else "2025-04-01-preview"
            if api_key is None or api_key == "":
                token_provider = get_bearer_token_provider(
                    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
                )
                self.params["azure_ad_token_provider"] = token_provider
            self.params["custom_llm_provider"] = "azure"
        elif self.endpoint == "ollama":
            self.params["api_base"] = api_base if api_base else "http://localhost:11434"
            self.params["max_tokens"] = self.params["max_completion_tokens"]
            if model.startswith("ollama/"):
                self.model = model
            else:
                self.model = f"ollama/{model}"

    @classmethod
    def from_config(cls, model_config: Dict[str, str]):
        """
        Create a client instance from model configuration.
        
        Args:
            model_config: Dictionary containing endpoint, model, api_key, api_base, api_version
            
        Returns:
            Client instance for making API calls
        """
        # Strip whitespace from all values
        for key in model_config:
            if isinstance(model_config[key], str):
                model_config[key] = model_config[key].strip()

        return cls(
            model_config["endpoint"],
            model_config["model"],
            model_config.get("api_key"),
            model_config.get("api_base"),
            model_config.get("api_version")
        )

    def get_completion(self, messages, stream=False):
        """
        Returns a LiteLLM client configured for the specified endpoint and model.
        Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
        """
        # Configure LiteLLM 

        if self.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.params.get("api_base", None),
                api_key=self.params.get("api_key", ""),
                timeout=120
            )

            completion_params = {
                "model": self.model,
                "messages": messages,
            }

            if self.model.startswith("gpt-5") or self.model.startswith("o1") or self.model.startswith("o3"):
                completion_params["reasoning_effort"] = "low"
            
            return client.chat.completions.create(**completion_params, stream=stream)
        else:

            params = self.params.copy()

            if (self.model.startswith("gpt-5") or self.model.startswith("o1") or self.model.startswith("o3")
                or self.model.startswith("claude-sonnet-4-5") or self.model.startswith("claude-opus-4")):
                params["reasoning_effort"] = "low"

            return litellm.completion(
                model=self.model,
                messages=messages,
                drop_params=True,
                stream=stream,
                **params
            )

        
    def get_response(self, messages: list[dict], tools: Optional[list] = None):
        """
        Returns a response using OpenAI's Response API approach.
        """
        if self.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.params.get("api_base", None),
                api_key=self.params.get("api_key", ""),
                timeout=120
            )
            return client.responses.create(
                model=self.model,
                input=messages,
                tools=tools,
                **self.params
            )
        else:
            return litellm.responses(
                model=self.model,
                input=messages,
                tools=tools,
                drop_params=True,
                **self.params
            )