#!/usr/bin/env python3
"""Run one local, versioned AI Chat modification job and save its evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}
BACKEND_DIAGRAM_TYPES = {
    "sequence": "sequence",
    "mermaid": "flow",
    "OpenAPI": "openapi",
    "openapi": "openapi",
    "plantuml": "plantuml",
}
REPO_ROOT = Path(__file__).resolve().parents[4]
MODEL_CONFIG_PATH = REPO_ROOT / "src/utils/aiModelConfig.ts"


class RequestFailure(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


def configured_default_model() -> str:
    source = MODEL_CONFIG_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"export\s+const\s+DEFAULT_AI_CHAT_MODEL\s*=\s*(['\"])([^'\"]+)\1",
        source,
    )
    if not match:
        raise SystemExit(f"Cannot read DEFAULT_AI_CHAT_MODEL from {MODEL_CONFIG_PATH}")
    return match.group(2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--model", help="Model override; defaults to DEFAULT_AI_CHAT_MODEL")
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--poll-interval", type=float, default=1.0)
    parser.add_argument("--deadline", type=float, default=135.0)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def relative_path(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None = None,
    timeout: float = 30,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raise RequestFailure(error.code, error.read().decode("utf-8", errors="replace")) from None
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        raise RequestFailure(0, raw) from None
    if not isinstance(result, dict):
        raise RequestFailure(0, raw)
    return result


def write_result(path: Path, record: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(temporary, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def prepare_output_dir(path: Path) -> None:
    if path.is_relative_to(REPO_ROOT) and not path.is_relative_to(
        REPO_ROOT / "private" / "local-data"
    ):
        raise SystemExit("Output inside conf-app must be under private/local-data")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise SystemExit("manifest must be a JSON object")
    for field in ("dslPath", "diagramType", "languageKey", "subTypeKey", "command"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise SystemExit(f"manifest requires a non-empty string: {field}")
    if manifest["diagramType"] not in BACKEND_DIAGRAM_TYPES:
        raise SystemExit("Unsupported AI Chat diagramType")
    if str(manifest.get("errorMessage") or "").strip():
        raise SystemExit("Ordinary AI Chat cases must not include errorMessage")
    expected_outcome = manifest.get("expectedOutcome")
    if expected_outcome not in {"change", "no_change"}:
        raise SystemExit("manifest expectedOutcome must be change or no_change")
    dsl = relative_path(manifest_path, manifest["dslPath"]).read_text(encoding="utf-8")
    if not dsl.strip():
        raise SystemExit("DSL file must not be empty")
    if args.poll_interval < 0 or args.deadline <= 0:
        raise SystemExit("poll interval must be non-negative and deadline must be positive")

    base_url = args.base_url.rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise SystemExit("Refusing non-local base URL; only localhost and 127.0.0.1 are allowed")
    model = args.model or configured_default_model()
    backend_diagram_type = BACKEND_DIAGRAM_TYPES[manifest["diagramType"]]
    input_hash = sha256(dsl)
    command_hash = sha256(manifest["command"])
    case_hash = sha256(dsl + "\0" + manifest["command"])
    output_dir = Path(args.output_dir).resolve()
    result_path = output_dir / "result.json"

    record: dict[str, Any] = {
        "layer": "L3",
        "flow": "ai-chat-versioned-modification",
        "baseUrl": base_url,
        "model": model,
        "clientDiagramType": manifest["diagramType"],
        "backendDiagramType": backend_diagram_type,
        "expectedOutcome": expected_outcome,
        "inputSha256": input_hash,
        "commandSha256": command_hash,
        "manifestPath": str(manifest_path),
        "dslPath": str(relative_path(manifest_path, manifest["dslPath"])),
        "status": "DRY_RUN" if args.dry_run else "RUNNING",
    }
    if args.dry_run:
        record["plannedRequests"] = [
            "POST /api/chat/ensure-diagram",
            "POST /api/chat/modify-version-async",
            "POST /api/chat/job-status (poll)",
        ]
        record["ensurePayload"] = {
            "diagramCode": dsl,
            "languageKey": manifest["languageKey"],
            "subTypeKey": manifest["subTypeKey"],
        }
        record["modifyPayloadTemplate"] = {
            "diagramId": "<from ensure-diagram>",
            "diagramCode": dsl,
            "diagramType": backend_diagram_type,
            "languageKey": manifest["languageKey"],
            "subTypeKey": manifest["subTypeKey"],
            "command": manifest["command"],
            "model": model,
        }
        prepare_output_dir(output_dir)
        write_result(result_path, record)
        print(f"DRY_RUN inputSha256={input_hash} result={result_path}")
        return 0

    api_key = os.environ.get("DIAGRAMLY_API_KEY")
    if not api_key:
        raise SystemExit("DIAGRAMLY_API_KEY is required (not needed for --dry-run)")
    external_id = str(manifest.get("externalId") or f"ai-chat-case-validation-{case_hash[:12]}")
    team_id = str(manifest.get("teamId") or f"ai-chat-case-validation-team-{case_hash[:12]}")
    headers = {"x-api-key": api_key, "x-external-id": external_id, "x-team-id": team_id}
    prepare_output_dir(output_dir)
    started = time.perf_counter()
    record["requests"] = []
    record["responses"] = {}
    try:
        ensure_payload = {
            "diagramCode": dsl,
            "languageKey": manifest["languageKey"],
            "subTypeKey": manifest["subTypeKey"],
        }
        ensured = request_json("POST", f"{base_url}/api/chat/ensure-diagram", headers, ensure_payload)
        record["requests"].append({"method": "POST", "path": "/api/chat/ensure-diagram", "payload": ensure_payload})
        record["responses"]["ensureDiagram"] = ensured
        diagram_id = ensured.get("diagramId")
        if not isinstance(diagram_id, str) or not diagram_id.strip():
            raise RuntimeError("ensure-diagram returned no diagramId")

        modify_payload = {
            "diagramId": diagram_id,
            "diagramCode": dsl,
            "diagramType": backend_diagram_type,
            "languageKey": manifest["languageKey"],
            "subTypeKey": manifest["subTypeKey"],
            "command": manifest["command"],
            "model": model,
        }
        if "errorMessage" in modify_payload:
            raise AssertionError("versioned AI Chat payload must not include errorMessage")
        modify_response = request_json(
            "POST", f"{base_url}/api/chat/modify-version-async", headers, modify_payload
        )
        record["requests"].append(
            {"method": "POST", "path": "/api/chat/modify-version-async", "payload": modify_payload}
        )
        record["responses"]["modifyVersionAsync"] = modify_response
        job_id = modify_response.get("jobId") or modify_response.get("data", {}).get("jobId")
        if not isinstance(job_id, str) or not job_id:
            raise RuntimeError("modify-version-async returned no jobId")

        deadline = time.monotonic() + args.deadline
        poll_count = 0
        status: dict[str, Any] = {}
        while time.monotonic() < deadline:
            poll_count += 1
            status = request_json(
                "POST", f"{base_url}/api/chat/job-status", headers, {"jobId": job_id}
            )
            record["requests"].append(
                {"method": "POST", "path": "/api/chat/job-status", "payload": {"jobId": job_id}}
            )
            record["responses"][f"jobStatus{poll_count}"] = status
            if status.get("status") in TERMINAL:
                break
            time.sleep(max(0.05, args.poll_interval))
        else:
            status = {"status": "TIMEOUT", "error": "Polling deadline exceeded"}
            record["responses"]["finalJobStatus"] = status
        record.update(
            {
                "status": status.get("status", "UNKNOWN"),
                "diagramId": diagram_id,
                "jobId": job_id,
                "pollCount": poll_count,
                "wallMs": round((time.perf_counter() - started) * 1000),
            }
        )
        output = status.get("output")
        output = output if isinstance(output, dict) else {}
        candidate = output.get("diagramCode")
        has_code = isinstance(candidate, str) and bool(candidate.strip())
        no_change = output.get("noChange") is True
        has_version = isinstance(output.get("versionId"), str) and bool(
            output["versionId"].strip()
        )
        if status.get("status") != "COMPLETED":
            record["failureReason"] = "job_not_completed"
        elif status.get("error"):
            record["failureReason"] = "job_error"
        elif not has_code:
            record["failureReason"] = "diagram_code_missing"
        elif expected_outcome == "change" and no_change:
            record["failureReason"] = "unexpected_no_change"
        elif expected_outcome == "change" and not has_version:
            record["failureReason"] = "version_id_missing"
        elif expected_outcome == "change" and candidate.replace("\r\n", "\n").strip() == dsl.replace("\r\n", "\n").strip():
            record["failureReason"] = "unchanged_code"
        elif expected_outcome == "no_change" and not no_change:
            record["failureReason"] = "unexpected_change"
        elif expected_outcome == "no_change" and candidate.replace("\r\n", "\n").strip() != dsl.replace("\r\n", "\n").strip():
            record["failureReason"] = "no_change_code_mismatch"
        record["technicalStatus"] = "FAIL" if record.get("failureReason") else "PASS"
    except RequestFailure as error:
        record.update({"status": "FAILED", "technicalStatus": "FAIL", "httpStatus": error.status, "responseBody": error.body})
    except Exception as error:  # preserve failure evidence without echoing input or responses
        record.update({"status": "FAILED", "technicalStatus": "FAIL", "errorType": type(error).__name__, "error": str(error)})
    record["wallMs"] = round((time.perf_counter() - started) * 1000)
    write_result(result_path, record)
    print(
        f"{record['status']} technicalStatus={record.get('technicalStatus', 'UNVERIFIED')} inputSha256={input_hash} "
        f"pollCount={record.get('pollCount', 0)} result={result_path}"
    )
    return 0 if record.get("technicalStatus") == "PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
