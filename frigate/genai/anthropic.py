"""Anthropic Claude Provider for Frigate AI."""

import base64
import logging
from typing import Any, AsyncGenerator, Optional

from frigate.config import GenAIProviderEnum
from frigate.genai import GenAIClient, register_genai_provider

logger = logging.getLogger(__name__)

# Claude models always have a 200 K token context window.
_CONTEXT_SIZE = 200_000
# Frigate scene descriptions are short; keep max_tokens conservative.
_DEFAULT_MAX_TOKENS = 1024


@register_genai_provider(GenAIProviderEnum.anthropic)
class AnthropicClient(GenAIClient):
    """Generative AI client for Frigate using Anthropic Claude.

    Requires the ``anthropic`` Python package (``pip install anthropic``).

    Example config.yml entry::

        genai:
          claude:
            provider: anthropic
            api_key: sk-ant-...
            model: claude-sonnet-4-6
            # Optional: point at a proxy / custom endpoint
            # base_url: https://your-proxy.example.com
    """

    def _init_provider(self) -> Any:
        try:
            import anthropic
        except ImportError:
            logger.error(
                "anthropic package is not installed. "
                "Install it with: pip install anthropic"
            )
            return None

        kwargs: dict[str, Any] = {"api_key": self.genai_config.api_key}
        if self.genai_config.base_url:
            kwargs["base_url"] = self.genai_config.base_url

        try:
            return anthropic.Anthropic(**kwargs)
        except Exception as e:
            logger.error("Failed to initialize Anthropic client: %s", e)
            return None

    def _send(
        self,
        prompt: str,
        images: list[bytes],
        response_format: Optional[dict] = None,
    ) -> Optional[str]:
        """Submit a request to Claude. response_format is ignored (not supported)."""
        if self.provider is None:
            return None

        content: list[dict[str, Any]] = []
        for image in images:
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(image).decode("utf-8"),
                    },
                }
            )
        content.append({"type": "text", "text": prompt})

        max_tokens = int(
            self.genai_config.provider_options.get("max_tokens", _DEFAULT_MAX_TOKENS)
        )
        runtime_opts = {
            k: v
            for k, v in self.genai_config.runtime_options.items()
            if k != "max_tokens"
        }

        try:
            result = self.provider.messages.create(
                model=self.genai_config.model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": content}],
                timeout=self.timeout,
                **runtime_opts,
            )
            if result and result.content:
                return result.content[0].text.strip()
            return None
        except Exception as e:
            logger.warning("Anthropic returned an error: %s", str(e))
            return None

    def list_models(self) -> list[str]:
        return [
            "claude-opus-4-7",
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
            "claude-3-opus-latest",
        ]

    def get_context_size(self) -> int:
        return _CONTEXT_SIZE

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        tool_choice: Optional[str] = "auto",
    ) -> dict[str, Any]:
        if self.provider is None:
            return {"content": None, "tool_calls": None, "finish_reason": "error"}

        try:
            max_tokens = int(
                self.genai_config.provider_options.get(
                    "max_tokens", _DEFAULT_MAX_TOKENS
                )
            )
            params: dict[str, Any] = {
                "model": self.genai_config.model,
                "max_tokens": max_tokens,
                "messages": self._convert_messages(messages),
                "timeout": self.timeout,
            }
            if tools:
                params["tools"] = [self._convert_tool(t) for t in tools]
                if tool_choice and tool_choice != "auto":
                    params["tool_choice"] = {"type": tool_choice}

            result = self.provider.messages.create(**params)
            return self._parse_response(result)
        except Exception as e:
            logger.warning("Anthropic chat_with_tools error: %s", str(e))
            return {"content": None, "tool_calls": None, "finish_reason": "error"}

    async def chat_with_tools_stream(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        tool_choice: Optional[str] = "auto",
    ) -> AsyncGenerator[tuple[str, Any], None]:
        # Anthropic streaming is complex with tool_use blocks; fall back to
        # a non-streaming call and emit a single delta + final message.
        result = self.chat_with_tools(messages, tools, tool_choice)
        if result.get("content"):
            yield ("content_delta", result["content"])
        yield ("message", result)

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _convert_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert OpenAI-style messages to the Anthropic messages format.

        ``system`` role messages are dropped (pass via ``system=`` parameter
        on the top-level call if needed; Frigate does not use system prompts
        here).
        """
        result = []
        for msg in messages:
            role = msg.get("role", "user")
            if role == "system":
                continue
            content = msg.get("content", "")
            result.append({"role": role, "content": content})
        return result

    @staticmethod
    def _convert_tool(tool: dict[str, Any]) -> dict[str, Any]:
        """Convert OpenAI function-calling tool schema to Anthropic tool schema."""
        fn = tool.get("function", tool)
        return {
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        }

    @staticmethod
    def _parse_response(result: Any) -> dict[str, Any]:
        """Parse an Anthropic Messages response into the standard dict format."""
        text_content: Optional[str] = None
        tool_calls: Optional[list[dict[str, Any]]] = None

        for block in result.content:
            if block.type == "text":
                text_content = block.text.strip() or None
            elif block.type == "tool_use":
                if tool_calls is None:
                    tool_calls = []
                tool_calls.append(
                    {
                        "id": block.id,
                        "name": block.name,
                        "arguments": block.input,
                    }
                )

        finish_reason = "tool_calls" if tool_calls else "stop"
        return {
            "content": text_content,
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
        }
