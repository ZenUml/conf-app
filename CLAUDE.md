# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a ZenUML Confluence Cloud Add-on that provides diagramming capabilities for Confluence users. The add-on supports three main diagram types:
- **Sequence Diagrams** (ZenUML & Mermaid)
- **Graph Diagrams** (powered by DrawIO)
- **OpenAPI/Swagger Specifications**

The project is built as a full-stack application with:
- **Frontend**: Vue 3 with TypeScript, Vite build system
- **Backend**: Cloudflare Workers with D1 database
- **Deployment**: Cloudflare Pages

## Development Commands

### Building and Testing
```bash
# Build full version
pnpm build:full

# Build lite version  
pnpm build:lite

# Run unit tests
pnpm test:unit

# Run E2E tests
pnpm test:e2e
```

### Development Server
```bash
# Start local development (frontend only)
pnpm start:local

# Start full development environment (frontend + backend proxy)
pnpm start:sit

# Serve built files via Wrangler
pnpm wrangler:serve
```

### Deployment
```bash
# Deploy to staging
pnpm wrangler:publish:stg

# Deploy lite version to staging
pnpm wrangler:publish:stg:lite
```

### Linting
```bash
# Run Vue linting
pnpm lint:vue
```

## Architecture Overview

### Frontend Structure
- **Entry Points**: Multiple HTML files for different diagram types (`index.html`, `sequence-editor.html`, `sequence-viewer.html`, etc.)
- **Core Components**:
  - `Workspace.vue` - Main editor interface with split layout
  - `Editor/Editor.vue` - Code editor with syntax highlighting
  - `DiagramPortal.vue` - Diagram rendering portal
  - `Header/Header.vue` - Navigation and actions
  - `Viewer/` - Different viewers for each diagram type

### Backend Structure (Cloudflare Workers)
- **Functions**: Located in `functions/` directory
- **Database**: D1 database with migrations in `functions/migrations/`
- **Key Endpoints**:
  - `/descriptor` - Atlassian Connect descriptor
  - `/custom-content/` - Custom content management
  - `/diagram-likes/` - Diagram like/unlike functionality
  - `/attachment` - File attachment handling

### Content Management
The app uses multiple storage providers for diagram persistence:
- **MacroBodyStorageProvider** - Stores data in macro body
- **ContentPropertyStorageProvider** - Stores data in Confluence content properties
- **CustomContentStorageProvider** - Stores data as custom content
- **CompositeContentProvider** - Combines multiple providers

### Key Models
- **Diagram** - Core diagram model with content and metadata
- **ContentProvider** - Abstract interface for data persistence
- **ApWrapper2** - Atlassian Connect JavaScript API wrapper
- **MacroIdentifier** - Identifies macro instances

## Product Variants

The add-on comes in two variants:
- **Full Version** (`PRODUCT_TYPE=full`) - All features enabled
- **Lite Version** (`PRODUCT_TYPE=lite`) - Reduced feature set

## Environment Configuration

### Local Development
1. Copy `wrangler-dev.toml` to `wrangler.toml`
2. Set up D1 database bindings
3. Configure environment variables in `wrangler.toml`

### Database Setup
```bash
# Create D1 database
wrangler d1 create zenuml-for-confluence

# Run migrations
wrangler d1 migrations apply zenuml-for-confluence --remote
```

## E2E Test Principles

### Fail Fast
E2E tests must fail immediately with a clear error when a precondition is not met — never wait out a timeout. Specifically:

- **Macro not found**: After searching the macro browser, check `option.count()` immediately. If 0, throw with the macro name, appLabel, search term, and the list of available options. Do NOT let `locator.click()` wait 60 seconds before timing out.
- **General principle**: Any assertion about UI state should use an explicit check + immediate throw rather than relying on Playwright's implicit timeout as the failure mechanism.

This prevents slow CI feedback (a single missing macro caused 6 × 60s = ~6 min of wasted waiting across parallel tests).

## Integration Testing

1. Run `pnpm start:sit` to start both frontend and backend
2. Expose port 8080 publicly (e.g., via ngrok)
3. Install the add-on using the descriptor URL
4. Test functionality in a Confluence instance

## Key Dependencies

- **@zenuml/core** - Core ZenUML rendering engine
- **mermaid** - Mermaid diagram rendering
- **swagger-ui** - OpenAPI/Swagger rendering
- **codemirror** - Code editor functionality
- **vue** - Frontend framework
- **@sentry/cloudflare** - Error tracking

## File Structure Notes

- `src/` - Frontend source code
- `functions/` - Cloudflare Workers backend
- `public/` - Static assets and DrawIO integration
- `drawio/` - DrawIO editor and viewer integration
- `tests/` - Unit and E2E tests
- `docs/` - Project documentation