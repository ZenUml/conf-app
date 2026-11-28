# PR 1345 evidence: team-share prompt

Baseline: origin/main 88609841d (no strip; CSAT prompt after first save). Candidate: 9e960f6dd.

- `default.png`, `no-title.png`, `copied-message.png`, `copied-link.png`, `manual-copy-fallback.png`: Storybook (TeamShareBanner stories).
- `tunnel-*.png`: Forge tunnel, Lite development environment, our own dev site. 02 = page before the first save, 07 = view-mode strip after it, 08/12 = after Copy message / Copy link, 14 = after Not now, 10 = shown once, 06 = no strip in edit mode.
Limits: the manual-copy fallback was seen in Storybook only; staging not yet checked.
