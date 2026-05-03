# Playwright E2E Test Workflows

This repository contains two approaches for running Playwright E2E tests with Claude Code:

## 📋 Workflows Overview

### 1. Direct CLI Approach (`claude-code-playwright.yml`)
**Use when:**
- You need maximum control and transparency
- Debugging workflow issues
- Testing new configurations locally first
- Simple, straightforward test execution

**Characteristics:**
- ✅ Simple and direct
- ✅ Easy to debug
- ✅ Full control over execution
- ✅ Minimal abstraction
- ⚠️ Manual Claude Code installation
- ⚠️ Basic error handling
- ⚠️ Manual output formatting

### 2. Claude Code Action Approach (`playwright-test-with-action.yml`)
**Use when:**
- You want production-ready test automation
- You need formatted output in GitHub UI
- You want automatic setup and error handling
- You're running scheduled tests or manual workflow runs

**Characteristics:**
- ✅ Automatic Claude Code installation
- ✅ Enhanced debug output formatting
- ✅ Built-in progress tracking
- ✅ Better error handling and reporting
- ✅ Structured artifact management
- ✅ GitHub step summaries
- ⚠️ More abstraction layers
- ⚠️ Slightly more complex configuration
- ⚠️ **Does NOT support `push` events** (use workflow_dispatch or schedule only)

## 🚀 Quick Start

### Running with Direct CLI
```bash
# Trigger manually
gh workflow run claude-code-playwright.yml

# With custom test file
gh workflow run claude-code-playwright.yml \
  -f markdown_test_file="tests/e2e-tests/markdown/custom-test.md" \
  -f model="claude-sonnet-4-5-20250929"
```

### Running with Claude Code Action
```bash
# Trigger manually
gh workflow run playwright-test-with-action.yml

# With custom test file
gh workflow run playwright-test-with-action.yml \
  -f markdown_test_file="tests/e2e-tests/markdown/custom-test.md" \
  -f model="claude-haiku-4-5-20251001"
```

## 🔐 Required Secrets

Both workflows require the following secrets to be configured in your repository:

### Authentication Secrets
- `CLAUDE_CODE_OAUTH_TOKEN` - Claude Code OAuth token (run `/install-github-app` in Claude Code CLI)
- `ANTHROPIC_AUTH_TOKEN` - Anthropic API key (for direct CLI approach)
- `ANTHROPIC_BASE_URL` - Optional: Custom Anthropic API base URL

### Confluence Test Credentials
- `ZENUML_STAGE_USERNAME` - Confluence staging username
- `ZENUML_STAGE_PASSWORD` - Confluence staging password
- `ATLASSIAN_OTP` - TOTP secret for Confluence MFA
- `ZENUML_DOMAIN` - Optional: Confluence domain
- `ZENUML_SPACE` - Optional: Confluence space key

### Setting Up Secrets
```bash
# Using GitHub CLI
gh secret set CLAUDE_CODE_OAUTH_TOKEN
gh secret set ZENUML_STAGE_USERNAME
gh secret set ZENUML_STAGE_PASSWORD
gh secret set ATLASSIAN_OTP

# Or via GitHub UI:
# Settings → Secrets and variables → Actions → New repository secret
```

## 📊 Comparison Table

| Feature | Direct CLI | Claude Code Action |
|---------|-----------|-------------------|
| **Setup Complexity** | Low | Medium |
| **Claude Code Install** | Manual | Automatic ✅ |
| **Debug Output** | Raw logs | Formatted UI ✅ |
| **Progress Tracking** | None | GitHub UI ✅ |
| **Error Handling** | Basic | Enhanced ✅ |
| **Step Summaries** | Manual | Automatic ✅ |
| **Artifact Management** | Manual | Structured ✅ |
| **Execution Time** | ~10 minutes | ~10 minutes |
| **Flexibility** | High ✅ | Medium |
| **Best For** | Development | Production ✅ |

## 📁 Output Artifacts

Both workflows produce the following artifacts:

### Screenshots
- `login-success.png` - Screenshot after successful login
- Additional screenshots captured during test execution

### Playwright Traces
- `trace.zip` - Complete Playwright trace for debugging
  - Open with: `npx playwright show-trace trace.zip`

### Videos (Action approach only)
- `test-recording.mp4` - Video of the entire test execution

### Execution Logs
- `execution.log` - Detailed debug logs with timestamps
- `debug.log` - Claude Code debug output

## 🔍 Debugging Failed Tests

### View Logs in GitHub UI
1. Navigate to Actions → Select the failed run
2. Click on the failed job
3. Review the "Execute Markdown Test" step output
4. Check the "Test Summary" for high-level status

### Download and Inspect Artifacts
```bash
# List recent workflow runs
gh run list --workflow=playwright-test-with-action.yml

# Download artifacts from a specific run
gh run download <run-id>

# View Playwright trace
npx playwright show-trace test-results-*/trace.zip
```

### Common Issues

#### 1. Unsupported Event Type: push
**Error:** `Prepare step failed with error: Unsupported event type: push`
**Cause:** `claude-code-action` only supports interactive events (pull_request, issue_comment, etc.) and automated events (workflow_dispatch, schedule)
**Solution:**
- Use `workflow_dispatch` for manual test runs
- Use `schedule` for automated daily/weekly runs
- If you need tests on push, use the Direct CLI workflow (`claude-code-playwright.yml`) instead

#### 2. Missing Credentials
**Error:** `ZENUML_STAGE_USERNAME is not provided`
**Solution:** Ensure all required secrets are set in repository settings

#### 3. OTP Generation Fails
**Error:** `Invalid OTP code`
**Solution:**
- Verify `ATLASSIAN_OTP` secret is correct
- Check system time is synchronized
- OTP codes expire every 30 seconds

#### 4. Playwright Browser Not Found
**Error:** `Executable doesn't exist at .../chromium`
**Solution:** The workflow already handles this, but if it fails:
```yaml
- run: npx playwright install chromium --with-deps
```

#### 5. Test Timeout (10+ minutes)
**Cause:** AI model processing time for complex tests
**Solutions:**
- Use faster model (haiku instead of sonnet)
- Split test into smaller steps
- Consider using traditional Playwright tests for CI/CD

## 🎯 Best Practices

### 1. Model Selection
- **Haiku** (`claude-haiku-4-5-20251001`): Fastest, good for simple tests
- **Sonnet** (`claude-sonnet-4-5-20250929`): Better reasoning, slower
- **For CI/CD**: Always use Haiku for speed

### 2. Test File Organization
```
tests/e2e-tests/markdown/
├── login-authentication.md     # Login flow test
├── diagram-creation.md         # Feature-specific tests
└── full-workflow.md            # End-to-end scenarios
```

### 3. Scheduled Testing
```yaml
# Run tests daily to catch regressions
schedule:
  - cron: '0 2 * * *'  # 2 AM UTC daily
```

### 4. Artifact Retention
```yaml
# Adjust based on storage needs
retention-days: 30  # Keep artifacts for 30 days
```

## 📚 Additional Resources

- [Claude Code Action Documentation](https://github.com/anthropics/claude-code-action)
- [Playwright MCP Server](https://github.com/microsoft/playwright-mcp)
- [Claude Code CLI Reference](https://docs.claude.com/en/docs/claude-code/cli-reference)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

## 🤝 Contributing

When adding new test cases:

1. Create markdown test files in `tests/e2e-tests/markdown/`
2. Follow the format in `login-authentication.md`
3. Test locally first using Claude Code CLI
4. Add workflow dispatch triggers for manual testing
5. Update this README with new test descriptions

## 💡 Tips

- **Local Testing**: Test markdown files locally before committing
  ```bash
  claude --print --dangerously-skip-permissions "$(cat test.md)"
  ```

- **Debug Mode**: Always use `--debug` flag for troubleshooting

- **Trace Analysis**: Playwright traces are invaluable for debugging browser issues
  ```bash
  npx playwright show-trace trace.zip
  ```

- **Cost Optimization**: Use Haiku model for routine tests to reduce API costs
