#!/usr/bin/env python3
"""Add deterministic validity and preservation metrics to benchmark records."""

from __future__ import annotations

import argparse
import difflib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

KEYWORDS = {
    "graph",
    "flowchart",
    "sequencediagram",
    "participant",
    "note",
    "over",
    "class",
    "interface",
    "package",
    "actor",
    "entity",
    "component",
    "startuml",
    "enduml",
    "alt",
    "else",
    "end",
    "loop",
    "opt",
    "par",
    "and",
    "rect",
    "title",
    "skinparam",
    "legend",
    "left",
    "right",
    "top",
    "bottom",
    "of",
    "true",
    "false",
    "null",
    "openapi",
    "info",
    "paths",
    "responses",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--results", action="append", required=True)
    parser.add_argument("--diagramly-path", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for record in records:
        candidate = record.get("candidatePath")
        if candidate and not Path(candidate).is_absolute():
            record["candidatePath"] = str((path.parent / candidate).resolve())
    return records


def manifest_relative(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (
        path.resolve()
        if path.is_absolute()
        else (manifest_path.parent / path).resolve()
    )


def normalized(value: str) -> str:
    return value.replace("\r\n", "\n").strip()


def identifiers(code: str) -> set[str]:
    found: set[str] = set()
    patterns = [
        r"\bparticipant\s+([A-Za-z_][\w.-]*)",
        r"\b(?:class|interface|entity|actor|component|node)\s+\"?([A-Za-z_][\w.-]*)",
        r"\b([A-Za-z_][\w.-]*)(?=\s*(?:--?>|--?>>|--|->>|\[|\(|\{|\.))",
    ]
    for pattern in patterns:
        found.update(re.findall(pattern, code, flags=re.IGNORECASE | re.MULTILINE))
    for token in re.findall(r"\b[A-Za-z_][A-Za-z0-9_.:-]*\b", code):
        if token.lower() in KEYWORDS:
            continue
        if any(char.isdigit() for char in token) or "_" in token or token.isupper():
            found.add(token)
    if found:
        return found
    return {
        token
        for token in re.findall(r"\b[A-Za-z_][A-Za-z0-9_.:-]{2,}\b", code)
        if token.lower() not in KEYWORDS
    }


def changed_line_ratio(before: str, after: str) -> float:
    left, right = before.splitlines(), after.splitlines()
    denominator = max(len(left), len(right), 1)
    changed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=left, b=right).get_opcodes():
        if tag != "equal":
            changed += max(i2 - i1, j2 - j1)
    return min(1.0, changed / denominator)


def validate_plantuml(candidate: Path) -> tuple[bool | None, str | None, bool]:
    if shutil.which("plantuml"):
        process = subprocess.run(
            ["plantuml", "-checkonly", str(candidate)],
            text=True,
            capture_output=True,
            check=False,
        )
        return (
            process.returncode == 0,
            (process.stdout + process.stderr)[-1000:] or None,
            False,
        )

    if not shutil.which("docker"):
        return None, "No plantuml command or Docker runtime", True
    inspect = subprocess.run(
        ["docker", "image", "inspect", "yuzutech/kroki:latest"],
        text=True,
        capture_output=True,
        check=False,
    )
    if inspect.returncode != 0:
        return None, "Local yuzutech/kroki:latest image is unavailable", True
    parent = candidate.parent.resolve()
    process = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--mount",
            f"type=bind,source={parent},target=/data,readonly",
            "--entrypoint",
            "/usr/bin/plantuml",
            "yuzutech/kroki:latest",
            "-checkonly",
            f"/data/{candidate.name}",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    return (
        process.returncode == 0,
        (process.stdout + process.stderr)[-1000:] or None,
        False,
    )


def node_validation(
    records: list[dict[str, Any]], language_key: str, diagramly_path: Path
) -> dict[str, dict[str, Any]]:
    items = [
        {"id": record["id"], "candidatePath": record["candidatePath"]}
        for record in records
        if record.get("candidatePath")
    ]
    if not items:
        return {}
    helper = Path(__file__).with_name("validate_candidates.ts").resolve()
    with tempfile.TemporaryDirectory(prefix="ai-repair-validate-") as temporary:
        manifest = Path(temporary) / "manifest.json"
        output = Path(temporary) / "output.json"
        manifest.write_text(
            json.dumps({"languageKey": language_key, "items": items}), encoding="utf-8"
        )
        process = subprocess.run(
            [
                "pnpm",
                "exec",
                "tsx",
                "--tsconfig",
                "scripts/tsconfig.json",
                str(helper),
                "--manifest",
                str(manifest),
                "--output",
                str(output),
                "--diagramly-path",
                str(diagramly_path),
            ],
            cwd=diagramly_path,
            text=True,
            capture_output=True,
            check=False,
        )
        if process.returncode != 0:
            raise RuntimeError(
                f"Diagramly validator failed: {(process.stdout + process.stderr)[-1500:]}"
            )
        return {
            item["id"]: item for item in json.loads(output.read_text(encoding="utf-8"))
        }


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    original = manifest_relative(manifest_path, manifest["dslPath"]).read_text(
        encoding="utf-8"
    )
    records: list[dict[str, Any]] = []
    for result_path in args.results:
        records.extend(read_jsonl(Path(result_path).resolve()))
    language_key = str(manifest["languageKey"])
    parsed = (
        {}
        if language_key == "LANG_PLANTUML"
        else node_validation(records, language_key, Path(args.diagramly_path).resolve())
    )
    original_identifiers = identifiers(original)
    required_anchors = [str(item) for item in manifest.get("requiredAnchors", [])]

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as output:
        for record in records:
            candidate_path_value = record.get("candidatePath")
            candidate = ""
            if candidate_path_value and Path(candidate_path_value).exists():
                candidate = Path(candidate_path_value).read_text(encoding="utf-8")
            no_op = bool(candidate) and normalized(candidate) == normalized(original)
            candidate_identifiers = identifiers(candidate)
            missing_identifiers = sorted(original_identifiers - candidate_identifiers)
            retention = (
                len(original_identifiers & candidate_identifiers)
                / len(original_identifiers)
                if original_identifiers
                else 1.0
            )
            missing_anchors = [
                anchor for anchor in required_anchors if anchor not in candidate
            ]

            if not candidate:
                syntax_valid, syntax_error, validation_skipped = (
                    False,
                    "Empty candidate",
                    False,
                )
            elif language_key == "LANG_PLANTUML":
                syntax_valid, syntax_error, validation_skipped = validate_plantuml(
                    Path(candidate_path_value).resolve()
                )
            else:
                validation = parsed.get(record["id"], {})
                validation_skipped = bool(validation.get("skipped"))
                syntax_error = validation.get("error")
                syntax_valid = None if validation_skipped else syntax_error is None

            hard_pass = bool(candidate) and not no_op and syntax_valid is True
            if validation_skipped:
                quality = "UNVERIFIED"
                repair_status = "SKIPPED"
            elif not hard_pass:
                quality = "FAIL"
                repair_status = "FAIL"
            elif missing_anchors or retention < 0.8:
                quality = "C"
                repair_status = "PASS"
            elif retention < 0.95:
                quality = "B"
                repair_status = "PASS"
            else:
                quality = "A"
                repair_status = "PASS"

            scored = {
                **record,
                "repairStatus": repair_status,
                "syntaxValid": syntax_valid,
                "syntaxError": syntax_error,
                "validationSkipped": validation_skipped,
                "noOp": no_op,
                "originalIdentifierCount": len(original_identifiers),
                "candidateIdentifierCount": len(candidate_identifiers),
                "missingIdentifierCount": len(missing_identifiers),
                "missingIdentifierSample": missing_identifiers[:20],
                "identifierRetention": round(retention, 4),
                "changedLineRatio": round(changed_line_ratio(original, candidate), 4)
                if candidate
                else None,
                "missingRequiredAnchors": missing_anchors,
                "qualityGrade": quality,
            }
            output.write(json.dumps(scored, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output_path), "records": len(records)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
