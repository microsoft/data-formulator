import litellm
import openai
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

class Client(object):
    """
    Returns a LiteLLM client configured for the specified endpoint and model.
    Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
    """
    def __init__(self, endpoint, model, api_key=None,  api_base=None, api_version=None):
        
        self.endpoint = endpoint
        self.model = model

        # other params, including temperature, max_completion_tokens, api_base, api_version
        self.params = {
            "temperature": 0.7,
        }

        if not (model == "o3-mini" or model == "o1"):
            self.params["max_completion_tokens"] = 1200

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
            self.params["api_version"] = api_version if api_version else "2024-02-15-preview"
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
        

    def get_completion(self, messages):
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
            
            if not (self.model == "o3-mini" or self.model == "o1"):
                completion_params["temperature"] = self.params["temperature"]
                completion_params["max_tokens"] = self.params["max_completion_tokens"]
                
            return client.chat.completions.create(**completion_params)
        else:
            return litellm.completion(
                model=self.model,
                messages=messages,
                drop_params=True,
                **self.params
            )