# Task Session Assignment and Wrap-up

## Delegation

The main session first groups cases by syntax/root cause and likely files to change. Evidence gathering and analysis that do not conflict may run in parallel; edits or validation involving a shared Prompt, parser, workspace, local service, or real browser must be serialized. Before creating separate Codex tasks, confirm the user actually requested multiple task sessions. For work divided within the current task, use collaboration.spawn_agent. Task instructions must include only absolute paths to private cases; do not copy customer content into task messages.

Each task instruction must specify at least:

1. Case directory, original input/error hashes, source status, and existing failure evidence; the original files must not be changed.
2. Assigned default/retry model, the task's authorized model-call scope, and the number of calls reserved from the main session's budget ledger. Without authorization, perform offline analysis only. After using its quota, return results; do not make extra calls.
3. Files owned by the task, or “analysis only; do not edit shared files.” Do not reset, stage, or commit existing workspace changes or files owned by other tasks.
4. Follow ai-repair-case-validation from the earliest failing layer; stop if L2/L3 fails. Save candidates, Prompt hash, model, and parse/render evidence under its dedicated attempts/<run-id>/.
5. If a shared Prompt/code change is needed, first report the minimum change and affected cases to the main session and wait for exclusive edit assignment. Do not allow multiple tasks to edit the same file concurrently.
6. Return a concise report of “verified facts, proposed fix, changed files, each layer's status, evidence paths, and blockers.” Do not reply only “success,” and do not paste customer DSL into the message.

For other tasks created explicitly, use send_message_to_thread for follow-up instructions only when the user directly authorized cross-task coordination; otherwise let the user continue in the target task. The main session waits using wait_threads and integrates results without frequent polling; subagents use the current collaboration tools. A task's status is not a substitute for reading and accepting its actual artifacts.

## Integration and final UI

The main session checks the impact of each change on all selected cases. After a shared Prompt change, retest affected cases from the earliest changed layer. Do not let a later task's PASS overwrite an earlier failure record. One session uses the current browser serially for L4. Obtain separate authorization before placing customer DSL in the specified Confluence test site, and follow the conf-app browser rules and ai-repair-case-validation/references/layer4.md. Each final PASS must point to a real post-Apply preview screenshot, not a simulated image generated from candidate code. If the browser cannot be controlled or site-data authorization is missing, mark SKIPPED/BLOCKED; do not create final-preview.json.

The final checklist distinguishes PASS, FAIL, SKIPPED, BLOCKED, and cases not yet reached. After interruption, resume from corpus.json, task results, and runs/<run-id>/run.json; do not skip this run's version gates because a candidate or old screenshot exists. Handle commits, pushes, deployments, publishing, and automation according to the user's current authorization and repository rules.
