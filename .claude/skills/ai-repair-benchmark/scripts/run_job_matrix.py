#!/usr/bin/env python3
"""Run the local Diagramly async repair job and polling layer."""

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
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--poll-interval", type=float, default=1.0)
    parser.add_argument("--deadline", type=float, default=135.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-remote", action="store_true")
    return parser.parse_args()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def safe_model(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", model)


def manifest_relative(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (
        path.resolve()
        if path.is_absolute()
        else (manifest_path.parent / path).resolve()
    )


def request_json(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout: float = 30,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {body[:500]}") from error


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dsl = manifest_relative(manifest_path, manifest["dslPath"]).read_text(
        encoding="utf-8"
    )
    models = list(manifest.get("models") or DEFAULT_MODELS)
    reasoning_specified = "reasoningDisabled" in manifest
    reasoning_disabled = (
        bool(manifest["reasoningDisabled"]) if reasoning_specified else None
    )
    base_url = args.base_url.rstrip("/")
    host = urllib.parse.urlparse(base_url).hostname
    if host not in {"localhost", "127.0.0.1"} and not args.allow_remote:
        raise SystemExit(f"Refusing non-local Diagramly host: {host}")
    if args.trials < 1:
        raise SystemExit("--trials must be positive")

    plan: list[tuple[int, str]] = []
    seed = int(manifest.get("seed", 0))
    for trial in range(1, args.trials + 1):
        ordered = models[:]
        random.Random(seed + 1000 + trial).shuffle(ordered)
        plan.extend((trial, model) for model in ordered)
    if args.dry_run:
        print(
            json.dumps(
                {
                    "layer": "L3",
                    "baseUrl": base_url,
                    "inputSha256": sha256(dsl),
                    "reasoningDisabled": reasoning_disabled,
                    "plan": [{"trial": trial, "model": model} for trial, model in plan],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    health = request_json("GET", f"{base_url}/api/health?deep=1", timeout=30)
    if health.get("status") != "ok" or health.get("db") != "up":
        raise SystemExit(f"Diagramly deep health failed: {json.dumps(health)}")
    api_key = os.environ.get("DIAGRAMLY_API_KEY")
    if not api_key:
        raise SystemExit("DIAGRAMLY_API_KEY is required")
    external_id = f"ai-repair-benchmark-{sha256(dsl)[:12]}"
    external_team_id = str(
        manifest.get("externalTeamId") or f"ai-repair-benchmark-team-{sha256(dsl)[:12]}"
    )
    headers = {
        "x-api-key": api_key,
        "x-external-id": external_id,
        "x-external-name": "AI Repair Benchmark Local",
        "x-team-id": external_team_id,
    }

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results_path = output_dir / "results.jsonl"
    run_id = output_dir.parent.name
    with results_path.open("w", encoding="utf-8") as results_file:
        for sequence, (trial, model) in enumerate(plan, start=1):
            started = time.perf_counter()
            record: dict[str, Any] = {
                "id": f"L3-{trial}-{safe_model(model)}",
                "runId": run_id,
                "layer": "L3",
                "model": model,
                "trial": trial,
                "sequence": sequence,
                "inputSha256": sha256(dsl),
                "requestedReasoningDisabled": reasoning_disabled,
                "costUsd": None,
                "costProvenance": "unavailable_job_output",
                "promptTokens": None,
                "completionTokens": None,
                "reasoningTokens": None,
                "cachedTokens": None,
                "totalTokens": None,
                "evidencePaths": [],
            }
            try:
                payload: dict[str, Any] = {
                    "diagramCode": dsl,
                    "diagramType": manifest["diagramType"],
                    "languageKey": manifest["languageKey"],
                    "subTypeKey": manifest.get("subTypeKey") or "GENERAL",
                    "errorMessage": manifest.get("errorMessage"),
                    "command": manifest.get("command") or "",
                    "model": model,
                }
                if reasoning_specified:
                    payload["disableReasoning"] = reasoning_disabled
                start_response = request_json(
                    "POST",
                    f"{base_url}/api/chat/modify-async",
                    headers,
                    payload,
                    timeout=30,
                )
                job_id = start_response.get("jobId")
                if not isinstance(job_id, str) or not job_id:
                    raise RuntimeError("modify-async returned no jobId")
                deadline = time.monotonic() + args.deadline
                poll_count = 0
                status: dict[str, Any] = {}
                while time.monotonic() < deadline:
                    poll_count += 1
                    status = request_json(
                        "POST",
                        f"{base_url}/api/chat/job-status",
                        headers,
                        {"jobId": job_id},
                        timeout=30,
                    )
                    if status.get("status") in TERMINAL:
                        break
                    time.sleep(max(0.05, args.poll_interval))
                else:
                    status = {"status": "TIMEOUT", "error": "Polling deadline exceeded"}

                output = (
                    status.get("output")
                    if isinstance(status.get("output"), dict)
                    else {}
                )
                candidate = (
                    output.get("diagramCode")
                    if isinstance(output.get("diagramCode"), str)
                    else ""
                )
                candidate_path = (
                    output_dir / f"candidate-{sequence:03d}-{safe_model(model)}.dsl"
                )
                if candidate:
                    candidate_path.write_text(candidate, encoding="utf-8")
                record.update(
                    {
                        "status": status.get("status"),
                        "jobId": job_id,
                        "pollCount": poll_count,
                        "wallMs": round((time.perf_counter() - started) * 1000),
                        "backendDurationMs": output.get("durationMs"),
                        "llmMs": output.get("llmDurationMs"),
                        "repairAttempts": output.get("repairAttempts"),
                        "reasoningDisabled": output.get("reasoningDisabled"),
                        "candidatePath": str(candidate_path) if candidate else None,
                        "error": status.get("error"),
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
                        "layer": "L3",
                        "trial": trial,
                        "model": model,
                        "status": record["status"],
                        "wallMs": record.get("wallMs"),
                        "pollCount": record.get("pollCount"),
                    },
                    ensure_ascii=False,
                )
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
