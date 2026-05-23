"""Z.AI Provider for Frigate AI (OpenAI-compatible coding API).

Z.AI is the international/coding-focused brand of Zhipu AI. It exposes the
GLM model family (including the GLM-4.5/4.6/5 series) via an OpenAI-compatible
HTTP API at ``https://api.z.ai/api/coding/paas/v4/``.

Unlike the standard OpenAI API, Z.AI accepts an additional top-level
``thinking`` parameter that toggles the GLM "thinking" / chain-of-thought
reasoning mode. The OpenAI Python SDK does not have native typing for that
parameter, so this provider forwards it through ``extra_body``.

Example config.yml entry::

    genai:
      zai:
        provider: zai
        api_key: your-zai-api-key
        model: glm-5
        provider_options:
          thinking: true            # enable GLM thinking mode
        runtime_options:
          temperature: 1.0
          max_tokens: 4096
"""

import base64
import json
import logging
from typing import Any, AsyncGenerator, Optional

from httpx import TimeoutException
from openai import OpenAI

from frigate.config import GenAIProviderEnum
from frigate.genai import register_genai_provider
from frigate.genai.openai import OpenAIClient

logger = logging.getLogger(__name__)

# Z.AI OpenAI-compatible coding endpoint
_ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"


@register_genai_provider(GenAIProviderEnum.zai)
class ZAIClient(OpenAIClient):
    """Z.AI client matching the official curl shape, including ``thinking``."""

    def _init_provider(self) -> OpenAI:
        provider_opts = {
            k: v
            for k, v in self.genai_config.provider_options.items()
            if k not in ("context_size", "thinking")
        }
        base_url = self.genai_config.base_url or _ZAI_BASE_URL
        return OpenAI(
            api_key=self.genai_config.api_key,
            base_url=base_url,
            **provider_opts,
        )

    def _thinking_extra_body(self) -> dict[str, Any]:
        """Return the ``extra_body`` payload that mirrors Z.AI's curl example.

        Set ``thinking: true`` (or any truthy value) in ``provider_options``
        to send ``{"thinking": {"type": "enabled"}}``. Disabled by default.
        """
        thinking = self.genai_config.provider_options.get("thinking")
        if not thinking:
            return {}
        if isinstance(thinking, dict):
            return {"thinking": thinking}
        # Accept bools / strings like "enabled" as shorthand
        return {"thinking": {"type": "enabled"}}

    def _send(
        self,
        prompt: str,
        images: list[bytes],
        response_format: Optional[dict] = None,
    ) -> Optional[str]:
        encoded_images = [base64.b64encode(img).decode("utf-8") for img in images]
        messages_content: list[dict] = [{"type": "text", "text": prompt}]
        for image in encoded_images:
            messages_content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image}",
                        "detail": "low",
                    },
                }
            )
        try:
            request_params: dict[str, Any] = {
                "model": self.genai_config.model,
                "messages": [{"role": "user", "content": messages_content}],
                "timeout": self.timeout,
                **self.genai_config.runtime_options,
            }
            if response_format:
                request_params["response_format"] = response_format

            extra_body = self._thinking_extra_body()
            if extra_body:
                request_params["extra_body"] = extra_body

            result = self.provider.chat.completions.create(**request_params)
            if (
                result is not None
                and hasattr(result, "choices")
                and len(result.choices) > 0
            ):
                message = result.choices[0].message
                content = message.content
                if not content:
                    reasoning_content = getattr(message, "reasoning_content", None)
                    if reasoning_content:
                        content = reasoning_content
                return str(content.strip()) if content else None
            return None
        except (TimeoutException, Exception) as e:
            logger.warning("Z.AI returned an error: %s", str(e))
            return None

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        tool_choice: Optional[str] = "auto",
    ) -> dict[str, Any]:
        try:
            tc: Optional[str] = None
            if tool_choice in ("none", "auto", "required"):
                tc = tool_choice

            request_params: dict[str, Any] = {
                "model": self.genai_config.model,
                "messages": messages,
                "timeout": self.timeout,
            }
            if tools:
                request_params["tools"] = tools
                if tc is not None:
                    request_params["tool_choice"] = tc

            if isinstance(self.genai_config.provider_options, dict):
                excluded = {"context_size", "thinking"}
                request_params.update(
                    {
                        k: v
                        for k, v in self.genai_config.provider_options.items()
                        if k not in excluded
                    }
                )

            extra_body = self._thinking_extra_body()
            if extra_body:
                request_params["extra_body"] = extra_body

            result = self.provider.chat.completions.create(**request_params)  # type: ignore[call-overload]
            if (
                result is None
                or not hasattr(result, "choices")
                or len(result.choices) == 0
            ):
                return {"content": None, "tool_calls": None, "finish_reason": "error"}

            choice = result.choices[0]
            message = choice.message
            content = message.content.strip() if message.content else None

            tool_calls = None
            if message.tool_calls:
                tool_calls = []
                for call in message.tool_calls:
                    try:
                        arguments = json.loads(call.function.arguments)
                    except (json.JSONDecodeError, AttributeError):
                        arguments = {}
                    tool_calls.append(
                        {
                            "id": getattr(call, "id", "") or "",
                            "name": getattr(call.function, "name", "") or "",
                            "arguments": arguments,
                        }
                    )

            finish_reason = "error"
            if hasattr(choice, "finish_reason") and choice.finish_reason:
                finish_reason = choice.finish_reason
            elif tool_calls:
                finish_reason = "tool_calls"
            elif content:
                finish_reason = "stop"

            return {
                "content": content,
                "tool_calls": tool_calls,
                "finish_reason": finish_reason,
            }
        except TimeoutException as e:
            logger.warning("Z.AI request timed out: %s", str(e))
            return {"content": None, "tool_calls": None, "finish_reason": "error"}
        except Exception as e:
            logger.warning("Z.AI returned an error: %s", str(e))
            return {"content": None, "tool_calls": None, "finish_reason": "error"}

    async def chat_with_tools_stream(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        tool_choice: Optional[str] = "auto",
    ) -> AsyncGenerator[tuple[str, Any], None]:
        try:
            tc: Optional[str] = None
            if tool_choice in ("none", "auto", "required"):
                tc = tool_choice

            request_params: dict[str, Any] = {
                "model": self.genai_config.model,
                "messages": messages,
                "timeout": self.timeout,
                "stream": True,
            }
            if tools:
                request_params["tools"] = tools
                if tc is not None:
                    request_params["tool_choice"] = tc

            if isinstance(self.genai_config.provider_options, dict):
                excluded = {"context_size", "thinking"}
                request_params.update(
                    {
                        k: v
                        for k, v in self.genai_config.provider_options.items()
                        if k not in excluded
                    }
                )

            extra_body = self._thinking_extra_body()
            if extra_body:
                request_params["extra_body"] = extra_body

            content_parts: list[str] = []
            tool_calls_by_index: dict[int, dict[str, Any]] = {}
            finish_reason = "stop"

            stream = self.provider.chat.completions.create(**request_params)  # type: ignore[call-overload]

            for chunk in stream:
                if not chunk or not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                if choice.finish_reason:
                    finish_reason = choice.finish_reason

                if delta.content:
                    content_parts.append(delta.content)
                    yield ("content_delta", delta.content)

                if delta.tool_calls:
                    for call in delta.tool_calls:
                        idx = call.index
                        fn = call.function

                        if idx not in tool_calls_by_index:
                            tool_calls_by_index[idx] = {
                                "id": call.id or "",
                                "name": fn.name if fn and fn.name else "",
                                "arguments": "",
                            }
                        slot = tool_calls_by_index[idx]
                        if call.id:
                            slot["id"] = call.id
                        if fn and fn.name:
                            slot["name"] = fn.name
                        if fn and fn.arguments:
                            slot["arguments"] += fn.arguments

            full_content = "".join(content_parts).strip() or None
            tool_calls_list = None
            if tool_calls_by_index:
                tool_calls_list = []
                for slot in tool_calls_by_index.values():
                    try:
                        parsed_args = json.loads(slot["arguments"])
                    except (json.JSONDecodeError, Exception):
                        parsed_args = slot["arguments"]
                    tool_calls_list.append(
                        {
                            "id": slot["id"],
                            "name": slot["name"],
                            "arguments": parsed_args,
                        }
                    )
                finish_reason = "tool_calls"

            yield (
                "message",
                {
                    "content": full_content,
                    "tool_calls": tool_calls_list,
                    "finish_reason": finish_reason,
                },
            )
        except TimeoutException as e:
            logger.warning("Z.AI streaming request timed out: %s", str(e))
            yield (
                "message",
                {"content": None, "tool_calls": None, "finish_reason": "error"},
            )
        except Exception as e:
            logger.warning("Z.AI streaming returned an error: %s", str(e))
            yield (
                "message",
                {"content": None, "tool_calls": None, "finish_reason": "error"},
            )

    def list_models(self) -> list[str]:
        return [
            "glm-5",
            "glm-4.6",
            "glm-4.5",
            "glm-4.5-air",
            "glm-4.5-flash",
            "glm-4-plus",
            "glm-4v-plus",
            "glm-4v",
            "glm-4v-flash",
            "glm-z1-flash",
        ]

    def get_context_size(self) -> int:
        if "context_size" in self.genai_config.provider_options:
            return int(self.genai_config.provider_options["context_size"])
        model = self.genai_config.model.lower()
        if model.startswith("glm-5"):
            return 200_000
        if "4v" in model or "4-" in model or "4.5" in model or "4.6" in model:
            return 128_000
        return 8_192
