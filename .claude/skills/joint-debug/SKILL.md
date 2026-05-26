# Joint Debug Skill

## Overview
This skill enables/disables the local development environment for joint debugging across three projects:
1. **confluence-plugin-cloud** (this project)
2. **worker** (Cloudflare Workers backend)
3. **diagramly** (AI backend service)

**What it does:**
- Modifies configuration files with marked changes
- Generates commands for users to manually run in their own terminals
- Does NOT automatically start any services

All modifications use comment markers `// [JOINT-DEBUG-START]` and `// [JOINT-DEBUG-END]` for easy toggling.

## Prerequisites
- All three projects cloned locally
- ngrok installed and configured
- pnpm installed
- All dependencies installed
- Code already deployed to required environments
- `wrangler.toml` configured with ngrok variables in `[vars]` section:
  - `NGROK_AUTHTOKEN` - ngrok authentication token
  - `NGROK_DOMAIN` - ngrok domain

## Commands

### Enable Joint Debug Mode
When user says "enable joint debug" or "start joint debug":

**What it does:**
- Modifies configuration files with marked changes
- Generates command for user to manually run the startup script
- Does NOT automatically execute the script

**Steps:**
1. **Verify `wrangler.toml` has required variables**
   - Check that `[vars]` section contains:
     - `NGROK_AUTHTOKEN`
     - `NGROK_DOMAIN`
   - If missing, inform user to add them manually

2. **Ask user for diagramly project path**
   - Prompt: "Please provide the full path to your diagramly project directory"
   - Example: `/Users/username/Documents/projects/diagramly-worktree`
   - Store this path for use in the startup script

3. **Modify `src/model/globals/forgeGlobal.ts`**
   - Find the `REMOTE_BASE_URL_MAP` object
   - Comment out original values and add joint debug versions with markers:
   ```typescript
   // [JOINT-DEBUG-START]
   DEVELOPMENT_LITE: '<NGROK_DOMAIN_value>',  // Use NGROK_DOMAIN value from wrangler.toml
   DEVELOPMENT_FULL: '<NGROK_DOMAIN_value>',  // Use NGROK_DOMAIN value from wrangler.toml
   // [JOINT-DEBUG-END]
   // DEVELOPMENT_LITE: 'localhost:8789',  // [JOINT-DEBUG-ORIGINAL]
   // DEVELOPMENT_FULL: 'localhost:8789',  // [JOINT-DEBUG-ORIGINAL]
   ```

   **Implementation**: Parse `wrangler.toml` to get the `NGROK_DOMAIN` value and use it here.

4. **Modify `wrangler.toml` - DIAGRAMLY_BACKEND_API_BASE_URL**
   - Comment out original value and add joint debug version:
   ```toml
   # [JOINT-DEBUG-START]
   DIAGRAMLY_BACKEND_API_BASE_URL = "http://localhost:3000"
   # [JOINT-DEBUG-END]
   # DIAGRAMLY_BACKEND_API_BASE_URL = "https://production-url.com"  # [JOINT-DEBUG-ORIGINAL]
   ```

5. **Modify `functions/_middleware.ts`**
   - Find `AUTHENTICATED_PATHS` array
   - Comment out the line containing `/diagramly`:
   ```typescript
   const AUTHENTICATED_PATHS = [
     '/forge-custom-content',
     '/forge-installed',
     // '/diagramly',  // [JOINT-DEBUG-DISABLED]
   ];
   ```

6. **Modify `src/components/SyntaxErrorBox.vue`**
   - Find the `isAiRepairEnabled` computed property
   - Make it return `true` directly:
   ```typescript
   // Computed property to determine if AI repair is enabled
   const isAiRepairEnabled = computed(() => {
     // [JOINT-DEBUG-START]
     return true;
     // [JOINT-DEBUG-END]
     // return aiRepairFeatureEnabled.value;  // [JOINT-DEBUG-ORIGINAL]
   });
   ```

7. **Provide script execution instructions to user**

   Parse `wrangler.toml` to extract `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` values, then display instructions:

   **Output to user:**
   ```
   ✅ Joint debug mode enabled!

   Configuration files updated with [JOINT-DEBUG] markers.

   To start all services, run this command in your terminal:

   ./.claude/skills/joint-debug/launch-debug-services.sh \
     "<NGROK_AUTHTOKEN_from_wrangler.toml>" \
     "<NGROK_DOMAIN_from_wrangler.toml>" \
     "/path/to/diagramly-worktree"

   This will open 5 terminal windows:
     1. Diagramly AI Service (port 3000)
     2. Cloudflare Worker (port 8789)
     3. ngrok Tunnel
     4. Confluence Plugin Frontend (port 8000)
     5. Forge Tunnel

   Expected services:
     - Diagramly:  http://localhost:3000
     - Worker:     http://localhost:8789
     - Frontend:   http://localhost:8000
     - ngrok:      https://<NGROK_DOMAIN>
     - Forge:      Tunnel active
   ```

**Implementation Notes**:
- Parse `wrangler.toml` to extract `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` values
- **Ask user for diagramly project path** before generating the command
- **Display the command** with actual values substituted for user to copy and run
- Do NOT automatically execute the script
- User will manually run the script in their terminal or commands

### Disable Joint Debug Mode
When user says "disable joint debug" or "stop joint debug":

**What it does:**
- Reverts all configuration file changes
- Does NOT stop any services (user manages services manually)
- Does NOT modify the startup script (it's parameter-based)

**Steps:**

1. **Revert `src/model/globals/forgeGlobal.ts`**
   - Remove lines between `// [JOINT-DEBUG-START]` and `// [JOINT-DEBUG-END]`
   - Uncomment lines marked with `// [JOINT-DEBUG-ORIGINAL]`

2. **Revert `wrangler.toml`**
   - Remove lines between `# [JOINT-DEBUG-START]` and `# [JOINT-DEBUG-END]`
   - Uncomment lines marked with `# [JOINT-DEBUG-ORIGINAL]`

3. **Revert `functions/_middleware.ts`**
   - Uncomment lines marked with `// [JOINT-DEBUG-DISABLED]`

4. **Revert `src/components/SyntaxErrorBox.vue`**
   - Remove lines between `// [JOINT-DEBUG-START]` and `// [JOINT-DEBUG-END]`
   - Uncomment lines marked with `// [JOINT-DEBUG-ORIGINAL]`

**Note**: User should manually stop any running services in their terminals if needed (Ctrl+C in each terminal window).

## Implementation Notes

### Marker Pattern
- Use `// [JOINT-DEBUG-START]` and `// [JOINT-DEBUG-END]` to wrap new code
- Use `// [JOINT-DEBUG-ORIGINAL]` to mark commented-out original code
- Use `// [JOINT-DEBUG-DISABLED]` to mark temporarily disabled code

### Search Pattern
To find all joint debug modifications:
```bash
grep -r "JOINT-DEBUG" src/ functions/ wrangler.toml
```

## Terminal Layout
When user runs the script, it will automatically open 5 terminal windows:
1. **Terminal 1: diagramly** - AI backend (port 3000) - Monitor AI service logs and API requests
2. **Terminal 2: worker** - Cloudflare Workers (port 8789) - Watch for runtime errors and function invocations
3. **Terminal 3: worker-ngrok** - ngrok tunnel - Observe tunnel status and HTTP traffic
4. **Terminal 4: confluence-plugin-cloud** - Frontend (port 8000) - Track build status and hot reload
5. **Terminal 5: forge-tunnel** - Forge tunnel (required) - Monitor Forge remote invocations

**Important**: User manually runs the script, which then automatically opens all terminal windows. Users can observe logs and debug issues in real-time in each window.

## Troubleshooting
- If ngrok URL changes, update `NGROK_DOMAIN` in `wrangler.toml` [vars] section
- Ensure ports 3000, 8000, 8789 are available
- Check diagramly is responding before starting full stack
- If markers are missing, the files haven't been set up for joint debug yet
