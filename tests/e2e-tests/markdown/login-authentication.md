# Test: Login Authentication

Using the Playwright MCP server, execute the following test steps:

## Setup
- Username: `process.env.ZENUML_STAGE_USERNAME`
- Password: `process.env.ZENUML_STAGE_PASSWORD`
- OTP: Generate using `otp.js` module (requires `process.env.ATLASSIAN_OTP`)

## Test Steps

1. Launch a Chromium browser in headless mode
2. Navigate to the URL: https://zenuml-stg.atlassian.net/wiki/spaces/ZS/overview

### Login - Username Entry
3. Fill the username input field `input[name=username]` with the value from `ZENUML_STAGE_USERNAME`
4. Click the submit button `#login-submit`

### Login - Password Entry
5. Fill the password input field `input[name=password]` with the value from `ZENUML_STAGE_PASSWORD`
6. Click the submit button `#login-submit`

### Multi-Factor Authentication (OTP)
7. Generate a TOTP code using the `otp.js` module (which uses `ATLASSIAN_OTP` environment variable)
8. Fill the OTP input field `#two-step-verification-otp-code-input` with the generated OTP
9. Click the OTP submit button `#two-step-verification-submit`

### Verification
10. Wait for the element with id `title-text` to become visible (timeout: 30 seconds)
11. Take a screenshot and save it as 'login-success.png' in the current directory
12. Verify the page loaded successfully by confirming the element is present
