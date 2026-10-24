-- Shared by deployment variants. Issuer is part of every key so a staging
-- credential cannot collide with one minted on another origin.
CREATE TABLE AgentLinkOAuthRefreshChain (
  issuer TEXT NOT NULL,
  chainId TEXT NOT NULL,
  revokedAtMs INTEGER,
  expiresAtMs INTEGER NOT NULL,
  PRIMARY KEY (issuer, chainId)
);
CREATE INDEX idx_agent_link_oauth_chain_expiry ON AgentLinkOAuthRefreshChain(expiresAtMs);

CREATE TABLE AgentLinkOAuthRefreshToken (
  issuer TEXT NOT NULL,
  tokenHash TEXT NOT NULL,
  chainId TEXT NOT NULL,
  userId TEXT NOT NULL,
  clientId TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expiresAtMs INTEGER NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0,
  legacyLineage INTEGER NOT NULL DEFAULT 0,
  usedAtMs INTEGER,
  successorHash TEXT,
  rotationNonce TEXT UNIQUE,
  receiptCiphertext TEXT,
  receiptIv TEXT,
  receiptExpiresAtMs INTEGER,
  PRIMARY KEY (issuer, tokenHash),
  FOREIGN KEY (issuer, chainId) REFERENCES AgentLinkOAuthRefreshChain(issuer, chainId)
);
CREATE INDEX idx_agent_link_oauth_token_expiry ON AgentLinkOAuthRefreshToken(expiresAtMs);
CREATE INDEX idx_agent_link_oauth_token_chain ON AgentLinkOAuthRefreshToken(issuer,chainId);
CREATE INDEX idx_agent_link_oauth_receipt_expiry ON AgentLinkOAuthRefreshToken(receiptExpiresAtMs);
