# Markdown E2E Tests

This directory contains E2E tests written in natural language markdown format that can be executed by Claude Code with the Playwright MCP server.

## Why Markdown Tests?

- **Readable**: Tests are written in plain English, making them easy to understand
- **Maintainable**: No complex TypeScript/JavaScript boilerplate
- **AI-Friendly**: Claude Code can interpret and execute natural language instructions
- **Accessible**: Non-developers can read, understand, and even write tests

## Running Tests

### Via GitHub Actions

1. Go to Actions tab in GitHub
2. Select "Claude Code with Playwright" workflow
3. Click "Run workflow"
4. Select the markdown test file to run
5. View results and artifacts (screenshots, traces)

### Locally with Claude Code CLI

```bash
cd tests/e2e-tests/markdown
claude --model claude-haiku-4-5-20251001 --dangerously-skip-permissions "$(cat login-authentication.md)"
```

## Test File Structure

Each markdown test file should follow this structure:

```markdown
# Test: [Descriptive Test Name]

## Configuration
- Environment: [Staging/Production]
- Base URL: [URL pattern]
- Authentication: [Required/Optional/None]

## Pre-requisites
[Any setup needed before test runs]

## Test Steps
1. [Clear, actionable step]
2. [Another step]
3. [Continue...]

## Expected Results
- ✅ [Expected outcome 1]
- ✅ [Expected outcome 2]

## Notes
[Any additional context or warnings]
```

## Writing Test Steps

### Navigation
- ❌ Bad: "Go to the page"
- ✅ Good: "Navigate to https://domain.atlassian.net/wiki/spaces/ZS/overview"

### Element Interactions
- ❌ Bad: "Click the button"
- ✅ Good: "Click the button with id 'submit-button'"
- ✅ Good: "Click the button labeled 'Save'"

### Assertions
- ❌ Bad: "Check if it works"
- ✅ Good: "Verify the element with id 'title-text' is visible"
- ✅ Good: "Confirm the page contains the text 'Welcome'"

### Waiting
- ❌ Bad: "Wait a bit"
- ✅ Good: "Wait for the element with id 'loading-spinner' to disappear"
- ✅ Good: "Wait up to 15 seconds for the page to load"

### Screenshots
- ✅ "Take a screenshot named 'login-success.png'"
- ✅ "Capture a screenshot of the element with class 'diagram-container'"

### Working with iFrames
- ✅ "Switch to the iframe with id containing 'zenuml-sequence-macro'"
- ✅ "In the iframe with src containing 'sequence-editor', click the 'Edit' button"

## Environment Variables

Tests can reference environment variables:
- `ZENUML_DOMAIN` - Confluence domain
- `ZENUML_SPACE` - Space key
- `ZENUML_STAGE_USERNAME` - Username for authentication
- `ZENUML_STAGE_PASSWORD` - Password for authentication

Example usage in test:
```markdown
Navigate to https://{ZENUML_DOMAIN}/wiki/spaces/{ZENUML_SPACE}/overview
```

## Best Practices

1. **Be Specific**: Use exact element selectors (id, data-testid, aria-label)
2. **Be Clear**: Write steps that are unambiguous
3. **Be Complete**: Include all necessary context
4. **Use Screenshots**: Capture evidence at key points
5. **Handle Timing**: Explicitly wait for elements/conditions
6. **Test One Thing**: Keep tests focused on a single feature/scenario

## Common Patterns

### Login Test
```markdown
1. Navigate to space overview page
2. Verify the element with id 'title-text' is visible (confirms logged in)
3. Take screenshot named 'authenticated.png'
```

### Form Interaction
```markdown
1. Navigate to page with form
2. Type "test@example.com" into the input with id 'email'
3. Click the button labeled 'Submit'
4. Wait for the element with class 'success-message' to appear
5. Verify the page contains text 'Submission successful'
```

### Macro Testing
```markdown
1. Navigate to page with ZenUML macros
2. Switch to iframe with id containing 'zenuml-sequence-macro'
3. Verify the iframe contains text 'Order Service'
4. Take screenshot named 'sequence-macro-loaded.png'
```

## Relationship to TypeScript Tests

- Markdown tests are a **supplement**, not a replacement (for now)
- TypeScript tests in `tests/` directory remain active
- Both test suites run independently
- Markdown tests focus on high-level user scenarios
- TypeScript tests can cover edge cases and unit-level testing

## Troubleshooting

### Test Fails to Execute
- Check that Playwright MCP server is configured in GitHub Actions
- Verify `--dangerously-skip-permissions` flag is used
- Ensure environment variables are set

### Test Results Unreliable
- Add explicit waits for elements to load
- Use more specific element selectors
- Check for timing issues in the application

### Screenshots Not Generated
- Ensure screenshot command includes file name
- Check `claude-output/` directory for generated files
- Verify GitHub Actions uploads artifacts correctly

## Future Enhancements

- Test result parsing and reporting
- Markdown test templates
- Auto-conversion from TypeScript tests
- Test coverage reporting
- Parallel test execution
