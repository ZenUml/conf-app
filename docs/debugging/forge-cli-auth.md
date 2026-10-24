# Forge CLI auth troubleshooting

Symptom: `forge whoami` (or any `forge` command) prints `Error: Not logged in. If a local keychain is available, run forge login...` even though you've already logged in elsewhere. Or `forge login` itself fails with `The CLI couldn't securely store your login credentials in a local keychain.`

Two root causes show up in this repo, often together:

## 1. Native `keytar` binding not built

The `keytar` npm package needs a postinstall step to compile `keytar.node`. If that step was skipped (cold pnpm install with prebuild-install offline, peer-dep warnings, etc.), keytar loads as a JS shell with no native ops, so reads return `null` and writes throw "couldn't securely store".

Diagnose:

```bash
ls node_modules/.pnpm/keytar@*/node_modules/keytar/build/Release/keytar.node
# missing → not built
```

Fix:

```bash
pnpm rebuild keytar
```

## 2. Login keychain is locked or auto-locks too aggressively

`forge login` writes via `keytar.setPassword`, which fails immediately if the keychain is locked — and macOS would normally pop a password dialog to unlock, but the dialog can get suppressed in non-TTY contexts (Claude bash, IDE-spawned shells).

Diagnose:

```bash
security show-keychain-info ~/Library/Keychains/login.keychain-db
# any non-zero "timeout=N" or "lock-on-sleep" means it auto-locks
```

Fix — reset to never-auto-lock for the rest of the session:

```bash
security set-keychain-settings ~/Library/Keychains/login.keychain-db
```

Then re-run `forge login` from a real Terminal.app (not Claude bash — the email/token prompts need a TTY).

## Order of operations

When both are wrong: rebuild keytar first, *then* fix the keychain lock, *then* re-login. The rebuild is harmless to repeat.

## Non-interactive fallback (CI)

If all else fails, use env vars:

```bash
export FORGE_EMAIL=<your-email>
export FORGE_API_TOKEN=<token from id.atlassian.com/manage-profile/security/api-tokens>
forge whoami   # confirms
```
