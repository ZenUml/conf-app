#!/usr/bin/env python3
"""Aggregate scored AI Repair records into a self-contained HTML report."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

MEASURED_COST = {"response_usage", "generation_api", "measured"}
GRADE_SCORE = {"A": 4, "B": 3, "C": 2, "UNVERIFIED": 1, "FAIL": 0}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument(
        "--redact-dsl",
        action="store_true",
        help="Omit the full input DSL for an explicitly public/redacted report.",
    )
    parser.add_argument("--html", required=True)
    return parser.parse_args()


def load_records(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text.startswith("["):
        value = json.loads(text)
        if not isinstance(value, list):
            raise ValueError(f"Expected JSON list: {path}")
        return [item for item in value if isinstance(item, dict)]
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def numbers(records: Iterable[dict[str, Any]], field: str) -> list[float]:
    return [
        value for record in records if (value := number(record.get(field))) is not None
    ]


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def is_pass(record: dict[str, Any]) -> bool:
    return str(record.get("repairStatus", "")).upper() == "PASS"


def measured_cost(record: dict[str, Any]) -> float | None:
    if record.get("costProvenance") not in MEASURED_COST:
        return None
    return number(record.get("costUsd"))


def l2_cost_medians(records: list[dict[str, Any]]) -> dict[str, float]:
    costs: dict[str, list[float]] = defaultdict(list)
    for record in records:
        cost = measured_cost(record)
        if record.get("layer") == "L2" and cost is not None:
            costs[str(record.get("model", "unknown"))].append(cost)
    return {model: statistics.median(values) for model, values in costs.items()}


def estimated_cost(
    record: dict[str, Any], l2_medians: dict[str, float]
) -> float | None:
    if str(record.get("repairStatus", "")).upper() == "SKIPPED":
        return None
    explicit = number(record.get("estimatedCostUsd"))
    if record.get("costProvenance") == "estimated_from_l2" and explicit is not None:
        return explicit
    if record.get("layer") in {"L3", "L4"} and measured_cost(record) is None:
        return l2_medians.get(str(record.get("model", "unknown")))
    return None


def summarize(
    layer: str,
    model: str,
    records: list[dict[str, Any]],
    l2_medians: dict[str, float],
) -> dict[str, Any]:
    wall = numbers(records, "wallMs")
    llm = numbers(records, "llmMs")
    costs = [cost for record in records if (cost := measured_cost(record)) is not None]
    estimates = [
        cost
        for record in records
        if (cost := estimated_cost(record, l2_medians)) is not None
    ]
    grades = Counter(
        str(record.get("qualityGrade") or "UNSCORED") for record in records
    )
    passed = sum(is_pass(record) for record in records)
    skipped = sum(
        str(record.get("repairStatus", "")).upper() == "SKIPPED" for record in records
    )
    attempted = len(records) - skipped
    quality_values = [
        GRADE_SCORE[grade]
        for record in records
        if str(record.get("repairStatus", "")).upper() != "SKIPPED"
        if (grade := str(record.get("qualityGrade", ""))) in GRADE_SCORE
    ]
    errors = Counter(
        str(record.get("syntaxError") or record.get("error"))[:160]
        for record in records
        if not is_pass(record) and (record.get("syntaxError") or record.get("error"))
    )
    return {
        "layer": layer,
        "model": model,
        "n": len(records),
        "attempted": attempted,
        "passed": passed,
        "skipped": skipped,
        "successRate": passed / attempted if attempted else 0.0,
        "coverageRate": attempted / len(records) if records else 0.0,
        "p50WallMs": percentile(wall, 0.50),
        "p95WallMs": percentile(wall, 0.95),
        "p50LlmMs": percentile(llm, 0.50),
        "promptTokens": sum(numbers(records, "promptTokens")),
        "completionTokens": sum(numbers(records, "completionTokens")),
        "reasoningTokens": sum(numbers(records, "reasoningTokens")),
        "cachedTokens": sum(numbers(records, "cachedTokens")),
        "measuredCostUsd": sum(costs),
        "measuredCostRuns": len(costs),
        "estimatedFromL2Usd": sum(estimates),
        "estimatedRuns": len(estimates),
        "quality": dict(sorted(grades.items())),
        "qualityMean": statistics.mean(quality_values) if quality_values else 0.0,
        "failureReasons": [
            {"reason": reason, "count": count}
            for reason, count in errors.most_common(3)
        ],
    }


def fmt_ms(value: Any) -> str:
    numeric = number(value)
    return "—" if numeric is None else f"{numeric / 1000:.2f}s"


def fmt_usd(value: Any, count: int) -> str:
    numeric = number(value)
    return "—" if not count or numeric is None else f"${numeric:.6f}"


def fmt_tokens(value: Any) -> str:
    numeric = number(value)
    return "0" if numeric is None else f"{int(numeric):,}"


def html_text(value: Any) -> str:
    return html.escape(str(value), quote=True)


def manifest_relative(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return (
        path.resolve()
        if path.is_absolute()
        else (manifest_path.parent / path).resolve()
    )


def load_input_context(manifest_path: Path, redact_dsl: bool) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dsl_path = manifest_relative(manifest_path, str(manifest["dslPath"]))
    dsl = dsl_path.read_text(encoding="utf-8")
    return {
        "fileName": dsl_path.name,
        "diagramType": manifest.get("diagramType") or "unknown",
        "languageKey": manifest.get("languageKey") or "unknown",
        "subTypeKey": manifest.get("subTypeKey") or "GENERAL",
        "errorMessage": manifest.get("errorMessage") or "—",
        "sha256": hashlib.sha256(dsl.encode("utf-8")).hexdigest(),
        "characters": len(dsl),
        "lines": len(dsl.splitlines()),
        "dsl": None if redact_dsl else dsl,
        "redacted": redact_dsl,
    }


def model_label(model: str) -> str:
    return model.split("/", 1)[-1]


def model_color(model: str) -> str:
    if model.startswith("openai/"):
        return "#7c3aed"
    if model.startswith("deepseek/"):
        return "#0891b2"
    if model.startswith("google/"):
        return "#ea580c"
    return "#475569"


def render_html_report(
    path: Path,
    records: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    model_rows: list[dict[str, Any]],
    input_context: dict[str, Any],
) -> None:
    planned = len(records)
    skipped = sum(
        str(record.get("repairStatus", "")).upper() == "SKIPPED" for record in records
    )
    attempted = planned - skipped
    passed = sum(is_pass(record) for record in records)
    measured_costs = [
        cost for record in records if (cost := measured_cost(record)) is not None
    ]
    total_cost = sum(measured_costs)
    recommended = model_rows[0]["model"] if model_rows and model_rows[0]["attempted"] else "—"
    max_latency = max((number(row.get("p50WallMs")) or 0 for row in rows), default=1)

    failures = [
        (row["layer"], row["model"], item)
        for row in rows
        for item in row["failureReasons"]
    ]
    blockers = Counter(
        str(record.get("blocker") or "Blocker not recorded")
        for record in records
        if str(record.get("repairStatus", "")).upper() == "SKIPPED"
    )

    parts = [
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Repair Model Benchmark Report</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#64748b; --line:#dce3ed; --panel:#fff; --bg:#f5f7fb; --accent:#4f46e5; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(1180px, calc(100% - 32px)); margin:32px auto 64px; }
    .hero { padding:30px; color:#fff; border-radius:22px; background:linear-gradient(135deg,#172554,#4338ca 58%,#7c3aed); box-shadow:0 18px 50px #312e8133; }
    .hero h1 { margin:0 0 8px; font-size:32px; letter-spacing:-.02em; }
    .hero p { margin:0; color:#e0e7ff; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:18px 0 26px; }
    .metric,.panel { background:var(--panel); border:1px solid var(--line); border-radius:16px; box-shadow:0 8px 24px #3341550b; }
    .metric { padding:18px; }
    .metric small { display:block; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
    .metric strong { display:block; margin-top:5px; font-size:25px; }
    .panel { margin-top:18px; padding:22px; overflow:hidden; }
    .layers { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .layer-card { padding:17px; border:1px solid var(--line); border-radius:13px; background:#f8fafc; }
    .layer-card h3 { display:flex; align-items:center; gap:8px; margin:0 0 8px; font-size:15px; }
    .layer-card p { margin:0; color:#475569; }
    .layer-card b { color:var(--ink); }
    h2 { margin:0 0 14px; font-size:20px; }
    h3 { margin:20px 0 10px; font-size:15px; }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:11px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle; }
    th { color:#475569; background:#f8fafc; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    tr:last-child td { border-bottom:0; }
    code { font:12px ui-monospace,SFMono-Regular,Menlo,monospace; color:#334155; }
    .rank { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%; background:#eef2ff; color:#4338ca; font-weight:700; }
    .bar-row { display:grid; grid-template-columns:92px minmax(130px,1fr) 70px; align-items:center; gap:10px; margin:10px 0; }
    .bar-track { height:10px; background:#e8edf5; border-radius:999px; overflow:hidden; }
    .bar { height:100%; border-radius:inherit; }
    .muted { color:var(--muted); }
    .pill { display:inline-block; padding:3px 8px; border-radius:999px; background:#eef2ff; color:#4338ca; font-size:12px; font-weight:650; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
    .callout { padding:14px 16px; border-left:4px solid #f59e0b; background:#fffbeb; border-radius:8px; }
    .dsl-meta { display:flex; flex-wrap:wrap; gap:8px 18px; margin-bottom:14px; color:#475569; }
    .dsl-code { margin:14px 0 0; padding:18px; max-height:38rem; overflow:auto; border-radius:12px; background:#111827; color:#e5e7eb; white-space:pre; tab-size:2; }
    .dsl-code code { color:inherit; font-size:12px; line-height:1.55; }
    ul { margin:8px 0 0; padding-left:20px; }
    footer { margin-top:22px; color:var(--muted); text-align:center; font-size:12px; }
    @media (max-width:800px) { .metrics,.grid2,.layers { grid-template-columns:1fr 1fr; } .panel { overflow-x:auto; } }
    @media (max-width:520px) { .metrics,.grid2,.layers { grid-template-columns:1fr; } .hero h1 { font-size:25px; } }
  </style>
</head>
<body><main>
  <section class="hero">
    <h1>AI Repair Model Benchmark Report</h1>
    <p>L1 Raw Model → L2 Diagramly Prompt</p>
  </section>
"""
    ]
    parts.append(
        '<section class="metrics">'
        f'<div class="metric"><small>Attempted</small><strong>{attempted}/{planned}</strong><span class="muted">coverage {attempted / planned:.1%}</span></div>'
        f'<div class="metric"><small>Repairs passed</small><strong>{passed}</strong><span class="muted">{passed / attempted if attempted else 0:.1%} of attempted</span></div>'
        f'<div class="metric"><small>OpenRouter actual cost</small><strong>${total_cost:.6f}</strong><span class="muted">{len(measured_costs)} runs with cost data</span></div>'
        f'<div class="metric"><small>L2 leader in this run</small><strong>{html_text(model_label(str(recommended)))}</strong><span class="muted">Ranked by success rate, quality, latency, and cost</span></div>'
        "</section>"
    )

    parts.append('<section class="panel"><h2>Repair input DSL</h2>')
    parts.append(
        '<div class="dsl-meta">'
        f"<span><b>File: </b><code>{html_text(input_context['fileName'])}</code></span>"
        f"<span><b>Type: </b><code>{html_text(input_context['diagramType'])}</code></span>"
        f"<span><b>Language: </b><code>{html_text(input_context['languageKey'])}</code></span>"
        f"<span><b>Subtype: </b><code>{html_text(input_context['subTypeKey'])}</code></span>"
        f"<span><b>Lines: </b>{input_context['lines']}</span>"
        f"<span><b>Characters: </b>{input_context['characters']}</span>"
        f"<span><b>SHA-256: </b><code>{html_text(input_context['sha256'])}</code></span>"
        "</div>"
    )
    parts.append(
        f'<div class="callout"><b>Parser error: </b> {html_text(input_context["errorMessage"])}</div>'
    )
    if input_context["redacted"]:
        parts.append(
            '<p class="muted">The full DSL was explicitly hidden with <code>--redact-dsl</code>; use this mode only for public or redacted reports.</p>'
        )
    else:
        parts.append(
            '<p class="muted">The following is the complete original DSL used across all layers in this run. This report contains the full input and must be stored only locally or in a private location.</p>'
            f'<pre class="dsl-code"><code>{html_text(input_context["dsl"])}</code></pre>'
        )
    parts.append("</section>")

    parts.append(
        """<section class="panel">
    <h2>What are L1 and L2?</h2>
    <p class="muted">This report compares repairs from direct model calls with repairs using the Diagramly prompt.</p>
    <div class="layers">
      <article class="layer-card">
        <h3><span class="pill">L1</span> Raw Model</h3>
        <p><b>Direct call to the selected OpenRouter model</b>, providing only the minimal repair instruction, original DSL, and actual error. Measures the model’s baseline repair ability.</p>
      </article>
      <article class="layer-card">
        <h3><span class="pill">L2</span> Diagramly Prompt</h3>
        <p>Add the current <b>Diagramly AI modification prompt, error context, and repair hints</b> for the same model. Tests only the LLM modification stage and measures the improvement from the product prompt.</p>
      </article>
    </div>
  </section>"""
    )

    parts.append('<section class="panel"><h2>L2 Model Overview</h2><table><thead><tr>')
    for heading in (
        "Rank",
        "Model",
        "PASS/Attempted",
        "Success rate",
        "coverage",
        "Mean quality",
        "p50",
        "Actual cost",
    ):
        parts.append(f"<th>{heading}</th>")
    parts.append("</tr></thead><tbody>")
    for index, row in enumerate(model_rows, start=1):
        color = model_color(str(row["model"]))
        parts.append(
            "<tr>"
            f'<td><span class="rank">{index}</span></td>'
            f'<td><span style="color:{color};font-weight:700">{html_text(row["model"])}</span></td>'
            f"<td>{row['passed']}/{row['attempted']}</td>"
            f"<td>{row['successRate']:.1%}</td>"
            f"<td>{row['coverageRate']:.1%}</td>"
            f"<td>{row['qualityMean']:.2f}</td>"
            f"<td>{fmt_ms(row['p50WallMs'])}</td>"
            f"<td>{fmt_usd(row['measuredCostUsd'], row['measuredCostRuns'])}</td>"
            "</tr>"
        )
    parts.append("</tbody></table></section>")

    parts.append('<section class="grid2">')
    parts.append('<div class="panel"><h2>Success rate</h2>')
    for row in rows:
        width = max(0.0, min(100.0, row["successRate"] * 100))
        color = model_color(str(row["model"]))
        parts.append(
            '<div class="bar-row">'
            f'<span><b>{html_text(row["layer"])}</b> <span class="muted">{html_text(model_label(str(row["model"])))}</span></span>'
            f'<div class="bar-track"><div class="bar" style="width:{width:.1f}%;background:{color}"></div></div>'
            f"<b>{row['successRate']:.1%}</b></div>"
        )
    parts.append("</div>")
    parts.append('<div class="panel"><h2>p50 total latency</h2>')
    for row in rows:
        latency = number(row.get("p50WallMs"))
        if latency is None:
            continue
        width = max(1.5, min(100.0, latency / max_latency * 100))
        color = model_color(str(row["model"]))
        parts.append(
            '<div class="bar-row">'
            f'<span><b>{html_text(row["layer"])}</b> <span class="muted">{html_text(model_label(str(row["model"])))}</span></span>'
            f'<div class="bar-track"><div class="bar" style="width:{width:.1f}%;background:{color}"></div></div>'
            f"<b>{fmt_ms(latency)}</b></div>"
        )
    parts.append("</div></section>")

    parts.append('<section class="panel"><h2>Layer Details</h2><table><thead><tr>')
    for heading in (
        "Layer",
        "Model",
        "PASS/Attempted",
        "Success rate",
        "p50 / p95",
        "p50 LLM",
        "Tokens (input/output/reasoning/cache)",
        "Actual cost",
        "Quality grade",
    ):
        parts.append(f"<th>{heading}</th>")
    parts.append("</tr></thead><tbody>")
    for row in rows:
        token_text = "/".join(
            fmt_tokens(row[field])
            for field in (
                "promptTokens",
                "completionTokens",
                "reasoningTokens",
                "cachedTokens",
            )
        )
        parts.append(
            "<tr>"
            f'<td><span class="pill">{html_text(row["layer"])}</span></td>'
            f"<td><code>{html_text(row['model'])}</code></td>"
            f"<td>{row['passed']}/{row['attempted']}</td>"
            f"<td>{row['successRate']:.1%}</td>"
            f"<td>{fmt_ms(row['p50WallMs'])} / {fmt_ms(row['p95WallMs'])}</td>"
            f"<td>{fmt_ms(row['p50LlmMs'])}</td>"
            f"<td>{token_text}</td>"
            f"<td>{fmt_usd(row['measuredCostUsd'], row['measuredCostRuns'])}</td>"
            f"<td>{html_text(json.dumps(row['quality'], ensure_ascii=False, sort_keys=True))}</td>"
            "</tr>"
        )
    parts.append("</tbody></table></section>")

    if failures:
        parts.append('<section class="panel"><h2>Main Failure Reasons</h2><ul>')
        for layer, model, item in failures:
            parts.append(
                f"<li><b>{html_text(layer)}</b> / <code>{html_text(model)}</code> × {item['count']}: "
                f"{html_text(item['reason'])}</li>"
            )
        parts.append("</ul></section>")
    if blockers:
        parts.append('<section class="panel"><h2>Coverage Blockers</h2>')
        for blocker, count in blockers.most_common():
            parts.append(
                f'<div class="callout"><b>× {count}</b> {html_text(blocker)}</div>'
            )
        parts.append("</section>")

    parts.append(
        """<section class="panel">
    <h2>Definitions and Limitations</h2>
    <ul>
      <li>Success rate is calculated as PASS / attempted; SKIPPED affects coverage only.</li>
      <li>Actual cost includes only OpenRouter response usage or generation API amounts.</li>
      <li>L1/L2 results do not validate async jobs or the real Forge UI; a single result does not establish a stable success rate or SLA.</li>
      <li>A/B/C grades reflect syntax gates and identifier retention; business semantics still require required anchors or manual review.</li>
    </ul>
  </section>
  <footer>AI Repair Benchmark · Self-contained report with no external scripts or resources.</footer>
</main></body></html>
"""
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(parts), encoding="utf-8")


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    input_context = load_input_context(manifest_path, args.redact_dsl)
    input_paths = [Path(value).resolve() for value in args.input]
    records = [record for path in input_paths for record in load_records(path)]
    if not records:
        raise SystemExit("No benchmark records found")
    unexpected_layers = sorted({str(record.get("layer")) for record in records} - {"L1", "L2"})
    if unexpected_layers:
        raise SystemExit(f"Benchmark accepts only L1/L2 records: {', '.join(unexpected_layers)}")
    for record in records:
        if str(record.get("repairStatus", "")).upper() != "PASS":
            continue
        if record.get("missingRequiredAnchors"):
            record["repairStatus"] = "FAIL"
            record["qualityGrade"] = "FAIL"
            record["error"] = "Required anchors were not preserved"
        elif record.get("renderValid") is False:
            record["repairStatus"] = "FAIL"
            record["qualityGrade"] = "FAIL"
            record["error"] = "Candidate failed render validation"
        elif record.get("renderValid") is not True:
            record["repairStatus"] = "SKIPPED"
            record["qualityGrade"] = "UNVERIFIED"
            record["blocker"] = "Render validation was not recorded"

    l2_medians = l2_cost_medians(records)
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    by_model: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        layer = str(record.get("layer") or "UNKNOWN")
        model = str(record.get("model") or "unknown")
        grouped[(layer, model)].append(record)
        if layer == "L2":
            by_model[model].append(record)

    rows = [
        summarize(layer, model, items, l2_medians)
        for (layer, model), items in sorted(grouped.items())
    ]
    model_rows = [
        summarize("L2", model, items, l2_medians) for model, items in by_model.items()
    ]
    model_rows.sort(
        key=lambda row: (
            -row["successRate"],
            -row["qualityMean"],
            row["p50WallMs"] if row["p50WallMs"] is not None else math.inf,
            row["measuredCostUsd"] / row["measuredCostRuns"]
            if row["measuredCostRuns"]
            else math.inf,
            row["model"],
        )
    )

    html_path = Path(args.html).resolve()
    render_html_report(html_path, records, rows, model_rows, input_context)
    print(
        json.dumps(
            {
                "html": str(html_path),
                "records": len(records),
                "groups": len(rows),
                "inputSha256": input_context["sha256"],
                "dslEmbedded": not input_context["redacted"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
