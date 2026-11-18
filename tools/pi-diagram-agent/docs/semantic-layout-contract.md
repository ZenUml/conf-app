# Pi diagram agent: semantic layout contract (high-level design)

How a `/magic` run on this branch works: the author must freeze a source-bound semantic layout contract (`diagram_layout_intent`) before any build, inspection or submit; every later check, review, judgement and acceptance is stamped with that contract's hash. Rendered: [semantic-layout-contract-roles.svg](semantic-layout-contract-roles.svg) (roles) and [semantic-layout-contract.svg](semantic-layout-contract.svg) (one run).

## Roles and trust boundaries

Deterministic code (blue) owns run state, hashes, the auditor, the gate and the manifest. Three model sessions (orange) never share context: the author plans and draws, the reviewer sees images plus the contract, the judge scores blind. The contract (yellow) is the spine: its hash is stamped on every check, review and judgement, and acceptance refuses a final hash that does not match.

Code: `src/layout-contract.mjs` (`LayoutContract`: freeze, revise, events, manifest fields) and `src/layout-intent.mjs` (`validateLayoutIntent`, `hashLayoutIntent`, the planning prompt). The orchestrator only calls `require()`, `submit()` and `manifestFields()` and resets its own round state after a revision.

```mermaid
flowchart TB
  Operator["Operator (human)<br/>/magic · /magic-judge · /magic-accept"]
  Facts["Source facts (code)<br/>parser + original Mermaid render<br/>effective group paths, adjudications applied"]
  Orch["Orchestrator (code, createV2Run)<br/>rounds · ledger · budgets · check cache<br/>auditor + early checks · gate"]
  Contract["Semantic layout contract (code)<br/>validateLayoutIntent: every node, relation, group path<br/>frozen in memory, hash over intent + sourceHash + rulesHash<br/>the hash stamps every check, review and judgement"]
  Author["Author (model, main Pi session, has tools)<br/>plans first, then writes make.py / layout.json / candidate.svg"]
  Reviewer["Reviewer (model, fresh session, no tools)<br/>images + source facts + geometry + contract"]
  Judge["Judge (model, two blind passes, no tools)<br/>IMPROVED / NOT_IMPROVED"]
  Manifest["Sealed manifest (code)<br/>authoritative copy outside the run dir, mirrored to run.json<br/>layoutIntent · history · events · finalLayoutIntentHash"]

  Operator -->|"/magic source.mmd"| Facts
  Facts -->|"effective model; unresolved conflict stops startup"| Orch
  Orch -->|"LAYOUT_INTENT_PROMPT + source facts"| Author
  Author <-->|"diagram_layout_intent: intent in, hash out<br/>revision needs predecessorHash + reason"| Contract
  Contract -->|"requireLayoutIntent gates build, inspect, submit<br/>revision resets ledger, cache, best, review"| Orch
  Author <-->|"diagram_build_check · diagram_inspect · diagram_submit<br/>findings back"| Orch
  Orch <-->|"images + contract as data<br/>findings; layout-intent violation blocks"| Reviewer
  Orch <-->|"final bytes vs original<br/>judgement.json sealed with layoutIntentHash"| Judge
  Orch -->|"run.json: intent hash on every check, review, judgement"| Manifest
  Operator <-->|"/magic-accept runDir sha<br/>assertFinalLayoutIntent: VALIDATED or refused"| Manifest

  classDef code fill:#eef3fb,stroke:#3b5998,color:#111
  classDef model fill:#fdf3e7,stroke:#c77d2b,color:#111
  classDef human fill:#eaf6ea,stroke:#3a7d44,color:#111
  classDef spine fill:#fff6cc,stroke:#b8860b,stroke-width:2px,color:#111
  class Facts,Orch,Manifest code
  class Author,Reviewer,Judge model
  class Operator human
  class Contract spine
```

## One `/magic` run

Planning is the first phase of the same author session and spends the same token and wall-clock budget. The auditor and source-facts steps are orchestrator self-calls here to keep the diagram at five participants.

```mermaid
zenuml
title Pi diagram agent v3: semantic layout contract before authoring
@Actor Operator
Orch as "Orchestrator"
Author as "Author session"
Reviewer as "Reviewer session"
Judge as "Judge"

// /magic src.mmd [--adjudication f]
Operator -> Orch.magic(source) {
  // parser + original render -> effective group paths
  // an unresolved node or group conflict stops startup
  Orch -> Orch.buildSourceFacts()
  // LAYOUT_INTENT_PROMPT + source facts
  // build, inspect, submit refused until frozen
  Orch -> Author.plan(facts) {
    // purpose, reading order, layers, peers,
    // relations, ranked constraints, uncertainties
    Author -> Orch.layoutIntent(intent) {
      // coverage, membership, endpoints checked
      // hash over intent + source + rules hashes
      Orch -> Orch.validate()
      return "ACCEPTED + hash"
    }
  }
  while("round < budget") {
    // author owns every position, port, route
    Orch -> Author.draw(findings) {
      // make.py -> candidate.svg; auditor + geometry
      // result stamped with layoutIntentHash
      Author -> Orch.buildCheck() {
        return "CHECK_PASS | FAIL"
      }
      // revise: predecessorHash + reason
      // resets ledger, cache, review, Judge receipts
      opt("better design needed") {
        Author -> Orch.layoutIntent(revised)
      }
      Author -> Orch.submit(hash)
    }
    // contract + facts + images; layout-intent violation blocks
    Orch -> Reviewer.review(images) {
      return findings
    }
    if("no blocking finding") {
      // two blind passes; judgement.json sealed with layoutIntentHash
      Orch -> Judge.score(images) {
        return "IMPROVED | NOT"
      }
    }
  }
  // run.json: layoutIntent, history, events, finalLayoutIntentHash
  return manifest
}
// VALIDATED only when judgement and manifest bind the final intent hash
Operator -> Orch.accept(runDir, sha)
```

## Contract object after the refactor

Who owns what once the contract is its own object: the orchestrator serialises, guards a finished run, resets its own round state and writes the manifest; `LayoutContract` validates, freezes, revises and records events behind private fields. Rendered: [layout-contract-sequence.svg](layout-contract-sequence.svg).

```mermaid
zenuml
title LayoutContract after the refactor: who owns what
Author as "Author session"
Ext as "pi-extension.ts"
Orch as "Orchestrator (createV2Run)"
Contract as "LayoutContract (src/layout-contract.mjs, #private state)"

// tool diagram_layout_intent {jobId, intent, predecessorHash?, reason?}
Author -> Ext.layoutIntent(params) {
  // serial(): one orchestrator operation at a time
  Ext -> Orch.submitLayoutIntent(opts) {
    // finalResult -> throw
    // LAYOUT_INTENT_RUN_FINISHED
    Orch -> Orch.guard()
    Orch -> Contract.submit(opts) {
      // predecessorHash == hash
      // and a reason, else throw
      Contract -> Contract.checkRevision()
      // validateLayoutIntent()
      // coverage, groups, edges
      Contract -> Contract.validate()
      // record + sha256 hash
      // #current / #history
      Contract -> Contract.freeze()
      // created | revised event
      // throw: failed event
      Contract -> Contract.recordEvent()
      return record
    }
    // throw: persist(), rethrow
    // reset findings, cache, best,
    // base, lastReview, exceptions
    Orch -> Orch.resetForNewContract()
    // manifestFields() -> run.json
    Orch -> Orch.persist()
    return "ACCEPTED + hash"
  }
}
// later: every diagram_build_check, diagram_inspect, diagram_submit
Author -> Ext.buildCheck(jobId) {
  Ext -> Orch.buildCheck() {
    // required && !frozen -> throw
    // LAYOUT_INTENT_REQUIRED
    Orch -> Contract.require()
    // entry stamped contract.hash
    Orch -> Orch.scriptCheck()
    return findings
  }
}
```

Diagnostics: `magic_layout_intent_created`, `magic_layout_intent_revised` and `magic_layout_contract_failed` are recorded in `run.json` only; the CLI sends no analytics.
