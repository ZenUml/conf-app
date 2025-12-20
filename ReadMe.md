# ZenUML for Confluence - Overview

## Project Description
ZenUML for Confluence is an Atlassian app (hybrid Connect/Forge) that empowers users to create and embed various types of diagrams directly within Confluence pages. It primarily focuses on sequence diagrams using ZenUML DSL but also supports Mermaid, DrawIO, and OpenAPI specifications.

## Key Features
- **ZenUML Sequence Diagrams**: Create sequence diagrams using a text-based DSL.
- **Mermaid Diagrams**: Support for Mermaid.js diagrams.
- **DrawIO Integration**: Create and edit graphs using DrawIO.
- **OpenAPI/Swagger**: Render OpenAPI specifications.
- **Embed Diagrams**: Embed existing diagrams, graphs, or API specs.
- **Lite vs. Full Versions**: The project has "Lite" and "Full" variants, differing in features and licensing.

## Architecture & Tech Stack

### Platform
- **Atlassian Forge/Connect**: The app uses Atlassian's Forge platform but also maintains Connect compatibility (hybrid app).
- **Cloudflare Pages**: Used for hosting the frontend assets.
- **Cloudflare Workers (Functions)**: Handles backend logic and API endpoints.
- **Cloudflare D1**: SQLite database at the edge for data persistence.

### Frontend
- **Framework**: Vue.js 3 (primary), React 17 (likely for specific integrations like Swagger UI or legacy components).
- **Build Tool**: Vite.
- **Styling**: TailwindCSS.
- **Diagramming Libraries**:
    - `@zenuml/core`: Core ZenUML rendering logic.
    - `mermaid`: Mermaid.js integration.
    - `swagger-ui`: For OpenAPI rendering.
    - `mxgraph` (via DrawIO): For graph editing.

### Backend
- **Runtime**: Node.js (via Cloudflare Workers `nodejs_compat`).
- **Language**: TypeScript/JavaScript.
- **Database**: Cloudflare D1 (SQLite).

### Testing
- **Unit Testing**: Vitest.
- **E2E Testing**: Playwright (indicated by `tests/e2e-tests` and scripts).

## Project Structure
- `src/`: Frontend source code (Vue components, logic).
- `functions/`: Backend Cloudflare Functions.
- `public/`: Static assets (HTML templates for different editors/viewers).
- `tests/`: Unit and E2E tests.
- `scripts/`: Build and deployment scripts.
- `manifest.yml`: Atlassian Forge manifest defining modules, permissions, and app configuration.
- `wrangler.toml`: Cloudflare Workers/Pages configuration.

## Deployment
- **Staging/Production**: Deployed to Cloudflare Pages.
- **CI/CD**: Scripts available for deploying to different environments (staging, production, developer-specific).

# Pre-release check
1. https://zenuml-stg.atlassian.net/wiki/spaces/ZS/pages/33152/Testing+Lite+1
   1. All content loads properly except for the second one.
2. (Lite) https://zenuml-stg.atlassian.net/wiki/display/ZS/customcontent/list/ac%3Acom.zenuml.confluence-addon-lite%3Azenuml-content-sequence
   1. Open a diagram and it should load fine
3. (Lite) https://zenuml-stg.atlassian.net/wiki/display/ZS/customcontent/list/ac%3Acom.zenuml.confluence-addon-lite%3Azenuml-content-graph
   1. Open a draw io diagram and it should load fine
4. (Full) https://zenuml-stg.atlassian.net/wiki/display/ZS/customcontent/list/ac%3Acom.zenuml.confluence-addon%3Azenuml-content-sequence
   1. Open a diagram and it should load fine
5. (Full) https://zenuml-stg.atlassian.net/wiki/display/ZS/customcontent/list/ac%3Acom.zenuml.confluence-addon%3Azenuml-content-graph
   1. Open a draw io diagram and it should load fine
6. https://zenuml-stg.atlassian.net/wiki/spaces/ZS/pages/31260964/VVVff
   1. Some diagrams have data source as content-property
7. Create a new page and add a sequence, a mermaid, a draw io diagram
# Development
## How to do integration test?
1. Start vue server at 8080 and proxy to 5000 for descriptor: `yarn start:sit`
2. Expose 8080 on air.zenuml.com: `yarn cloudflare:8080`
3. Install https://air.zenuml.com/atlassian-connect.json
4. Open the page with ZenUML macro
   
> We need two commands `start:local` and `start:sit` because hot-reload works 
> only on one domain.

## Setup Cloudflare Pages project for development

* Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) command line tool
* Create project
   ```
   wrangler pages project create zenuml-for-confluence
   # Enter the production branch name: … master
   ```
* Create D1 database
   ```
   wrangler d1 create zenuml-for-confluence
   ```
   Example output:
   ```
   [[d1_databases]]
   binding = "DB"
   database_name = "zenuml-for-confluence"
   database_id = "c11ca41f-4670-4640-9991-3aceb7fd114a"
   ```
* Copy the output to your `wrangler.toml`
* Add `migrations_dir = "functions/migrations"` config under `d1_database` section
Example file:
   ```
   compatibility_flags = [ "nodejs_compat" ]
   compatibility_date = "2024-11-11"
   name = "zenuml-for-confluence"
   pages_build_output_dir = "dist"

   [vars]
   DIAGRAMLY_BACKEND_API_BASE_URL = "https://staging.diagramly.ai"
   ENVIRONMENT = "development"  # Set to "development" for local development

   [env.production]
   ENVIRONMENT = "production"

   [[d1_databases]]
   binding = "DB"
   database_name = "zenuml-for-confluence"
   database_id = "c11ca41f-4670-4640-9991-3aceb7fd114a"
   migrations_dir = "functions/migrations"
   ```
* Run DB migration scripts
   ```
   wrangler d1 migrations apply zenuml-for-confluence --remote
   ```
* Run build: `pnpm build:full`
* Deploy:
   ```
   wrangler pages deploy dist
   ```
   Example output:
   ```
   ✨ Deployment complete! Take a peek over at https://ca7b4ae9.zenuml-for-confluence-5v2.pages.dev
   ✨ Deployment alias URL: https://diagram-likes.zenuml-for-confluence-5v2.pages.dev
   ```
* Install the app to your Confluence using the descriptor URL, e.g. https://diagram-likes.zenuml-for-confluence-5v2.pages.dev/descriptor for the Full app, or https://diagram-likes.zenuml-for-confluence-5v2.pages.dev/descriptor?lite for the Lite app

## Development with Docker Wrangler

### Setup run-docker-wrangler.sh
1. Make it executable:
```bash
chmod +x run-docker-wrangler.sh
```

2. Authentication
```bash
./run-docker-wrangler.sh login
```

3. Operations Samples
```bash
# Apply migrations to local database
./run-docker-wrangler.sh d1 migrations apply [database-name] --local

# Execute SQL command
./run-docker-wrangler.sh d1 execute [database-name]  --local --command "SELECT * FROM your_table;"

# Deploy
./run-docker-wrangler.sh pages deploy ./dist
```

## Development with Atlassian Forge

This section guides you through setting up and developing the app using Atlassian Forge.

### Prerequisites

- Ensure you have the Atlassian Forge CLI installed: `npm install -g @forge/cli`
- Authenticate with Forge: `forge login`

### Create Personal Development Environment

Create a personal development environment to isolate your changes:

```
forge environments create -e [YOUR_PERSONAL_ENV_NAME]
```

Set it as the default environment:

```
forge settings set default-environment [YOUR_PERSONAL_ENV_NAME]
```

### Build and Deploy

Build the lite version of the app:

```
pnpm build:lite
```

Remove the drawio directory to avoid exceeding the 50MB resource limit:

```
rm -rf dist/drawio
```

Deploy to your personal environment:

```
forge deploy
```

### Install the App

Install the app on your Confluence instance:

```
forge install -p Confluence -s [YOUR_ATLASSIAN_INSTANCE] --confirm-scopes
```

Replace `[YOUR_ATLASSIAN_INSTANCE]` with your Confluence site URL (e.g., `https://yoursite.atlassian.net`).

### Start Local Development Server and Tunnel

Start the local development server:

```
pnpm start:sit
```

In a separate terminal, start the tunnel to connect your local server to Atlassian:

```
forge tunnel
```

This allows you to test changes in real-time without redeploying.

# Errors
## Addon not registered; no compatible hosts detected
Check the sub code.

### upm.pluginInstall.error.ssl
Just re-register should fix it in most times.

### connect.install.error.remote.host.bad.response.401
401 is Unauthorized (or actually means Unauthenticated). It does not make sense as all content
is public. Simply restarting fixes this issue.

### Error: Please install sqlite3 package manually
1. rm -rf node_modules
2. yarn install

### Other errors
1. Get the descriptor
1. Validate the descriptor at https://atlassian-connect-validator.herokuapp.com/validate
1. Read the schema doc with: https://json-schema.app/view/%23?url=https%3A%2F%2Fbitbucket.org%2Fatlassian%2Fconnect-schemas%2Fraw%2Fmaster%2Fconfluence-global-schema.json
