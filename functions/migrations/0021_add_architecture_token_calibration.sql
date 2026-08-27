-- Architecture Tokens MVP-0. These tables are rebuildable derived output only:
-- Confluence custom content remains the source of truth. `tenantScope` is the
-- public pilot alias; the real cloud id stays in protected runtime config.
CREATE TABLE IF NOT EXISTS ArchitectureTokenCalibrationRun (
  runId TEXT PRIMARY KEY,
  tenantScope TEXT NOT NULL CHECK (tenantScope = 'example-tenant'),
  mode TEXT NOT NULL CHECK (mode = 'calibration'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  dryRun INTEGER NOT NULL CHECK (dryRun IN (0, 1)),
  retryOf TEXT,
  extractorModel TEXT NOT NULL,
  extractorPromptVersion TEXT NOT NULL,
  sourceCount INTEGER NOT NULL DEFAULT 0,
  acceptedCount INTEGER NOT NULL DEFAULT 0,
  rejectedCount INTEGER NOT NULL DEFAULT 0,
  abstainedCount INTEGER NOT NULL DEFAULT 0,
  failureStage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ArchitectureTokenSourceRun (
  runId TEXT NOT NULL REFERENCES ArchitectureTokenCalibrationRun(runId),
  sourceId TEXT NOT NULL,
  sourceRevision INTEGER NOT NULL,
  sourceHash TEXT NOT NULL,
  sourceFamily TEXT NOT NULL CHECK (sourceFamily = 'sequenceDiagram'),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  retryOf TEXT,
  candidateCount INTEGER NOT NULL DEFAULT 0,
  failureStage TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (runId, sourceId, sourceRevision)
);

CREATE TABLE IF NOT EXISTS ArchitectureTokenCandidate (
  runId TEXT NOT NULL,
  sourceId TEXT NOT NULL,
  sourceRevision INTEGER NOT NULL,
  sourceHash TEXT NOT NULL,
  sourceFamily TEXT NOT NULL CHECK (sourceFamily = 'sequenceDiagram'),
  candidateLabel TEXT NOT NULL,
  candidateType TEXT NOT NULL CHECK (candidateType IN ('service', 'api', 'external-service')),
  candidateRole TEXT NOT NULL,
  evidenceSnippet TEXT NOT NULL,
  extractorModel TEXT NOT NULL,
  extractorPromptVersion TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'abstained')),
  retryOf TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (runId, sourceId, sourceRevision, candidateType, candidateLabel),
  FOREIGN KEY (runId, sourceId, sourceRevision)
    REFERENCES ArchitectureTokenSourceRun(runId, sourceId, sourceRevision)
);

CREATE INDEX IF NOT EXISTS ix_architecture_token_candidate_source
  ON ArchitectureTokenCandidate (sourceHash, runId);
