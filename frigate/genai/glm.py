"""Zhipu AI GLM Provider for Frigate AI (OpenAI-compatible API)."""

import logging

from openai import OpenAI

from frigate.config import GenAIProviderEnum
from frigate.genai import register_genai_provider
from frigate.genai.openai import OpenAIClient

logger = logging.getLogger(__name__)

# Zhipu AI OpenAI-compatible endpoint
_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"


@register_genai_provider(GenAIProviderEnum.glm)
class GLMClient(OpenAIClient):
    """Generative AI client for Frigate using Zhipu AI GLM vision models.

    GLM-4V and GLM-4V-Plus support multi-image vision prompts via an
    OpenAI-compatible API. The ``base_url`` defaults to the Zhipu AI cloud
    endpoint; override it to point at a self-hosted GLM instance.

    Example config.yml entry::

        genai:
          glm:
            provider: glm
            api_key: your-zhipu-api-key
            model: glm-4v-flash   # fast & free-tier
            # model: glm-4v-plus  # higher accuracy
    """

    def _init_provider(self) -> OpenAI:
        provider_opts = {
            k: v
            for k, v in self.genai_config.provider_options.items()
            if k != "context_size"
        }
        base_url = self.genai_config.base_url or _GLM_BASE_URL
        return OpenAI(
            api_key=self.genai_config.api_key,
            base_url=base_url,
            **provider_opts,
        )

    def list_models(self) -> list[str]:
        return [
            "glm-4v-flash",
            "glm-4v",
            "glm-4v-plus",
            "glm-4-plus",
            "glm-z1-flash",
        ]

    def get_context_size(self) -> int:
        if "context_size" in self.genai_config.provider_options:
            return int(self.genai_config.provider_options["context_size"])
        model = self.genai_config.model.lower()
        # GLM-4V models support 128 K tokens
        return 128_000 if "4v" in model or "4-" in model else 8_192
