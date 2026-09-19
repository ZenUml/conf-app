#!/usr/bin/env python3
"""Run L1/L2 OpenRouter repair trials and retain usage/cost metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_MODELS = [
    "openai/gpt-5.6-luna",
    "deepseek/deepseek-v4-flash",
    "google/gemini-2.5-flash",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--mode", required=True, choices=("raw", "diagramly"))
    parser.add_argument("--messages")
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reparse-only", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def api_request(
    method: str,
    url: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 60,
) -> tuple[dict[str, Any], dict[str, str]]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "conf-app-ai-repair-benchmark/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return json.loads(response.read().decode("utf-8")), headers
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = {"error": body[:500]}
        raise RuntimeError(
            f"HTTP {error.code}: {json.dumps(detail, ensure_ascii=False)}"
        ) from error


def text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    return ""


def code_from_json(text: str) -> str | None:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and parsed.get("code"):
            code = parsed["code"]
            return (
                code.strip()
                if isinstance(code, str)
                else json.dumps(code, ensure_ascii=False, indent=2)
            )
    except json.JSONDecodeError:
        pass
    return None


def json_by_braces(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(start, len(text)):
        character = text[index]
        if quote:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character in {'"', "'"}:
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_candidate(content: str) -> str:
    stripped = content.strip()
    if candidate := code_from_json(stripped):
        return candidate
    match = re.search(r"```[\w.+-]*\n([\s\S]*?)\n```", stripped)
    if match:
        fenced = match.group(1).strip()
        return code_from_json(fenced) or fenced
    if (braced := json_by_braces(stripped)) and (candidate := code_from_json(braced)):
        return candidate
    return stripped


def raw_messages(manifest: dict[str, Any], dsl: str) -> list[dict[str, str]]:
    error = str(manifest.get("errorMessage") or "Diagram syntax is invalid.")
    language = str(manifest["languageKey"])
    return [
        {
            "role": "system",
            "content": (
                "Repair the supplied diagram DSL. Change only what is required to fix "
                "the reported error. Preserve intent, identifiers, labels, ordering, and "
                "unrelated formatting. Return the complete repaired DSL only, without "
                "Markdown fences or explanation."
            ),
        },
        {
            "role": "user",
            "content": f"Language: {language}\nParser error:\n{error}\n\nDSL:\n{dsl}",
        },
    ]


def usage_fields(response: dict[str, Any]) -> dict[str, Any]:
    usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    prompt_details = usage.get("prompt_tokens_details") or {}
    completion_details = usage.get("completion_tokens_details") or {}
    return {
        "promptTokens": usage.get("prompt_tokens"),
        "completionTokens": usage.get("completion_tokens"),
        "reasoningTokens": completion_details.get("reasoning_tokens"),
        "cachedTokens": prompt_details.get("cached_tokens"),
        "totalTokens": usage.get("total_tokens"),
        "costUsd": usage.get("cost"),
        "costProvenance": "response_usage"
        if usage.get("cost") is not None
        else "unavailable",
    }


def generation_metadata(
    base_url: str, api_key: str, generation_id: str
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/generation?{urllib.parse.urlencode({'id': generation_id})}"
    try:
        body, _ = api_request("GET", url, api_key, timeout=30)
    except Exception:  # noqa: BLE001 - metadata lookup must not fail the trial
        return {}
    data = body.get("data")
    return data if isinstance(data, dict) else {}


def safe_model(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", model)


def manifest_relative(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (
        path.resolve()
        if path.is_absolute()
        else (manifest_path.parent / path).resolve()
    )


def reparse_existing(output_dir: Path) -> int:
    results_path = output_dir / "results.jsonl"
    if not results_path.exists():
        raise SystemExit(f"Missing existing results: {results_path}")
    records = [
        json.loads(line)
        for line in results_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    reparsed = 0
    for record in records:
        raw_value = record.get("rawResponsePath")
        candidate_value = record.get("candidatePath")
        if not raw_value or not candidate_value:
            continue
        response = json.loads(Path(raw_value).read_text(encoding="utf-8"))
        choice = (response.get("choices") or [{}])[0]
        content = text_content((choice.get("message") or {}).get("content"))
        candidate = extract_candidate(content)
        Path(candidate_value).write_text(candidate, encoding="utf-8")
        record["status"] = "COMPLETED" if candidate else "FAILED"
        reparsed += 1
    temporary = results_path.with_suffix(".jsonl.tmp")
    temporary.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )
    temporary.replace(results_path)
    print(json.dumps({"results": str(results_path), "reparsed": reparsed}))
    return 0


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dsl_path = manifest_relative(manifest_path, manifest["dslPath"])
    dsl = dsl_path.read_text(encoding="utf-8")
    models = list(manifest.get("models") or DEFAULT_MODELS)
    if not models or args.trials < 1:
        raise SystemExit("models and trials must be non-empty")

    if args.mode == "diagramly":
        if not args.messages:
            raise SystemExit("--messages is required for diagramly mode")
        message_bundle = json.loads(
            Path(args.messages).resolve().read_text(encoding="utf-8")
        )
        messages = message_bundle["messages"]
        prompt_hash = message_bundle["promptHash"]
    else:
        messages = raw_messages(manifest, dsl)
        prompt_hash = sha256(json.dumps(messages, ensure_ascii=False, sort_keys=True))

    temperature = float(
        manifest.get("temperature", os.environ.get("AI_TEMPERATURE", "0.2"))
    )
    max_tokens = int(
        manifest.get("maxTokens", os.environ.get("AI_MAX_TOKENS", "10000"))
    )
    reasoning_disabled = (
        bool(manifest["reasoningDisabled"])
        if "reasoningDisabled" in manifest
        else os.environ.get("AI_DISABLE_REASONING") == "true"
    )
    seed = int(manifest.get("seed", 0))
    plan: list[tuple[int, str]] = []
    for trial in range(1, args.trials + 1):
        ordered = models[:]
        random.Random(seed + trial).shuffle(ordered)
        plan.extend((trial, model) for model in ordered)
    layer = "L1" if args.mode == "raw" else "L2"
    if args.reparse_only:
        return reparse_existing(Path(args.output_dir).resolve())
    if args.dry_run:
        print(
            json.dumps(
                {
                    "layer": layer,
                    "inputSha256": sha256(dsl),
                    "characters": len(dsl),
                    "lines": len(dsl.splitlines()),
                    "promptHash": prompt_hash,
                    "temperature": temperature,
                    "maxTokens": max_tokens,
                    "reasoningDisabled": reasoning_disabled,
                    "plan": [{"trial": trial, "model": model} for trial, model in plan],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY or OPENROUTER_API_KEY is required")
    base_url = (
        os.environ.get("OPENAI_BASEURL") or "https://openrouter.ai/api/v1"
    ).rstrip("/")
    host = urllib.parse.urlparse(base_url).hostname
    if host != "openrouter.ai":
        raise SystemExit(f"Refusing non-OpenRouter base URL host: {host}")

    model_catalog, _ = api_request("GET", f"{base_url}/models", api_key, timeout=60)
    available = {
        item.get("id")
        for item in model_catalog.get("data", [])
        if isinstance(item, dict)
    }
    missing = [model for model in models if model not in available]
    if missing:
        raise SystemExit(f"Models unavailable on OpenRouter: {', '.join(missing)}")

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results_path = output_dir / "results.jsonl"
    run_id = output_dir.parent.name
    existing_ids: set[str] = set()
    if args.resume and results_path.exists():
        existing_ids = {
            record["id"]
            for line in results_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
            for record in [json.loads(line)]
        }

    with results_path.open(
        "a" if args.resume else "w", encoding="utf-8"
    ) as results_file:
        for sequence, (trial, model) in enumerate(plan, start=1):
            record_id = f"{layer}-{trial}-{safe_model(model)}"
            if record_id in existing_ids:
                continue
            started = time.perf_counter()
            record: dict[str, Any] = {
                "id": record_id,
                "runId": run_id,
                "layer": layer,
                "model": model,
                "trial": trial,
                "sequence": sequence,
                "inputSha256": sha256(dsl),
                "promptHash": prompt_hash,
                "temperature": temperature,
                "maxTokens": max_tokens,
                "reasoningDisabled": reasoning_disabled,
                "costUsd": None,
                "costProvenance": "unavailable",
                "evidencePaths": [],
            }
            try:
                payload: dict[str, Any] = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "usage": {"include": True},
                }
                if reasoning_disabled:
                    payload["reasoning"] = {"enabled": False}
                response, headers = api_request(
                    "POST",
                    f"{base_url}/chat/completions",
                    api_key,
                    payload,
                    timeout=args.timeout,
                )
                wall_ms = round((time.perf_counter() - started) * 1000)
                choice = (response.get("choices") or [{}])[0]
                content = text_content((choice.get("message") or {}).get("content"))
                candidate = extract_candidate(content)
                candidate_path = (
                    output_dir / f"candidate-{sequence:03d}-{safe_model(model)}.dsl"
                )
                raw_path = (
                    output_dir / f"response-{sequence:03d}-{safe_model(model)}.json"
                )
                candidate_path.write_text(candidate, encoding="utf-8")
                raw_path.write_text(
                    json.dumps(response, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                generation_id = response.get("id") or headers.get("x-generation-id")
                usage = usage_fields(response)
                metadata = (
                    generation_metadata(base_url, api_key, generation_id)
                    if isinstance(generation_id, str)
                    else {}
                )
                if usage["costUsd"] is None and metadata.get("total_cost") is not None:
                    usage["costUsd"] = metadata["total_cost"]
                    usage["costProvenance"] = "generation_api"
                record.update(
                    {
                        "status": "COMPLETED" if candidate else "FAILED",
                        "wallMs": wall_ms,
                        "llmMs": wall_ms,
                        "generationId": generation_id,
                        "provider": metadata.get("provider_name"),
                        "finishReason": choice.get("finish_reason"),
                        "candidatePath": str(candidate_path),
                        "rawResponsePath": str(raw_path),
                        **usage,
                    }
                )
            except Exception as error:  # noqa: BLE001 - preserve each trial failure
                record.update(
                    {
                        "status": "FAILED",
                        "wallMs": round((time.perf_counter() - started) * 1000),
                        "error": str(error),
                    }
                )
            results_file.write(json.dumps(record, ensure_ascii=False) + "\n")
            results_file.flush()
            print(
                json.dumps(
                    {
                        "layer": layer,
                        "trial": trial,
                        "model": model,
                        "status": record["status"],
                        "wallMs": record.get("wallMs"),
                        "costUsd": record.get("costUsd"),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
