# Vision · Mermaid Text Editor

This is the authoritative version. The [Chinese translation](VISION.cn.md) follows this text.

## What we aim to achieve

Help people editing Mermaid diagrams in Confluence desktop find what to change, make the change, and confirm the result as quickly as possible.
Give as many users as possible the benefit of faster editing early, starting with common tasks such as changing a few lines.

## Optimize the whole edit

Measure from the moment the user starts looking for what to change until they confirm the diagram matches their intent.
Compare alternatives on the same representative tasks.
When their results all match the user's intent, use the total time across those tasks to decide which alternative is faster.
Preview refresh time, time by diagram type, the number of actions, and retries can explain differences.
If autocomplete saves a few keystrokes but obscures the source and makes the task take longer, adjust the interaction and test the same task again.

## Save time on the first use

People who edit Mermaid only occasionally should be able to open the editor and complete common changes immediately.
Use familiar editor interactions for core actions so that assistance saves time from the first use.
Include the time it takes to understand and learn an interaction when measuring first-use task time.

## Set priorities from real editing sessions

Use the [usage baseline](README.md) to see how many people enter the editor.
Use Clarity replays to see what users are trying to do and where they pause, search repeatedly, retry, or give up.
Record what users do and distinguish those observations from possible explanations.
Prioritize investigating friction that recurs in replays and materially slows down editing.

When customer feedback and telemetry both point to editing friction but replays do not yet explain the cause, run a small, reversible experiment to gather evidence before deciding whether to expand it.

## Let users confirm changes to meaning

Automatic changes that save time and can be undone may be applied directly to the source.
If a change clearly alters what the diagram means, show it to the user and get their confirmation before applying it.

## Scope and design decisions

The project covers the existing Mermaid source editor and how users move between the source and the diagram preview while editing.
Both local edits and whole-diagram rewrites are in scope.
Use whole-diagram rewrites for changes across multiple parts of a diagram when users can inspect the result and representative tasks show that the rewrite saves time across the whole edit.

When assistance saves time on representative tasks for some diagram types, it can reach those users first.
Extend support to other diagram types as it proves useful for their tasks.

Record specific solutions in ADRs.
Describe the user task, the evidence, the interaction options, and their trade-offs.
Explain how to compare total time, actions, or retries before and after the change on the same task, and how to check that the result still matches the user's intent.

The current phase is to observe how users edit, establish the problems, and discuss designs.
Treat proposals without enough evidence as hypotheses to test.
