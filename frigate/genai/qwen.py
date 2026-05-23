"""Alibaba Qwen Provider for Frigate AI (OpenAI-compatible DashScope API)."""

import logging

from openai import OpenAI

from frigate.config import GenAIProviderEnum
from frigate.genai import register_genai_provider
from frigate.genai.openai import OpenAIClient

logger = logging.getLogger(__name__)

# Alibaba DashScope OpenAI-compatible endpoint
_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


@register_genai_provider(GenAIProviderEnum.qwen)
class QwenClient(OpenAIClient):
    """Generative AI client for Frigate using Alibaba Qwen VL models.

    Qwen2.5-VL models support multi-image vision prompts via Alibaba's
    DashScope API, which is OpenAI-compatible. The ``base_url`` defaults to
    the DashScope cloud endpoint; override it to point at a self-hosted
    Qwen instance (e.g. via Ollama or vLLM).

    Example config.yml entry::

        genai:
          qwen:
            provider: qwen
            api_key: your-dashscope-api-key
            model: qwen-vl-max        # most capable
            # model: qwen-vl-plus     # balanced
            # model: qwen2.5-vl-7b-instruct  # self-hosted via vLLM/Ollama
            # base_url: http://localhost:8000/v1  # self-hosted override
    """

    def _init_provider(self) -> OpenAI:
        provider_opts = {
            k: v
            for k, v in self.genai_config.provider_options.items()
            if k != "context_size"
        }
        base_url = self.genai_config.base_url or _QWEN_BASE_URL
        return OpenAI(
            api_key=self.genai_config.api_key,
            base_url=base_url,
            **provider_opts,
        )

    def list_models(self) -> list[str]:
        return [
            "qwen-vl-max",
            "qwen-vl-plus",
            "qwen2.5-vl-72b-instruct",
            "qwen2.5-vl-32b-instruct",
            "qwen2.5-vl-7b-instruct",
            "qwen2.5-vl-3b-instruct",
        ]

    def get_context_size(self) -> int:
        if "context_size" in self.genai_config.provider_options:
            return int(self.genai_config.provider_options["context_size"])
        # Qwen2.5-VL models support up to 128 K tokens
        return 128_000
