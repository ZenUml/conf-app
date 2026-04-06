# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a ZenUML Confluence Cloud Add-on (Forge app) that provides diagramming capabilities for Confluence users. The add-on supports three main diagram types:
- **Sequence Diagrams** (ZenUML & Mermaid)
- **Graph Diagrams** (powered by DrawIO)
- **OpenAPI/Swagger Specifications**

The project is built as a full-stack application with:
- **Frontend**: Vue 3 with TypeScript, Vite build system, Forge Custom UI
- **Backend**: Cloudflare Workers with D1 database (accessed via Forge remotes)
- **Deployment**: Cloudflare Pages + Forge CLI
- **Platform**: Atlassian Forge (Connect runtime was removed; `app.connect` migration bridge in manifest.yml is kept for backward compatibility)

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

### Forge Deployment
```bash
# Deploy to Forge staging
pnpm forge:deploy:lite:staging
pnpm forge:deploy:full:prod

# Forge tunnel for local development
pnpm forge:tunnel
```

### Linting
```bash
# Run Vue linting
pnpm lint:vue
```

## Architecture Overview

### Frontend Structure
- **Entry Point**: Single Forge Custom UI entry (`index.html` + `src/forgeIndex.ts`)
- **Forge Entry Points**: `src/forge-*.ts` files for different diagram types
- **Core Components**:
  - `Workspace.vue` - Main editor interface with split layout
  - `Editor/Editor.vue` - Code editor with syntax highlighting
  - `DiagramPortal.vue` - Diagram rendering portal
  - `Header/Header.vue` - Navigation and actions
  - `Viewer/` - Different viewers for each diagram type
- **Forge Integration**: `@forge/bridge` for Confluence API access (`requestConfluence`, `invokeRemote`, `view`, `router`)

### Backend Structure (Cloudflare Workers)
- **Functions**: Located in `functions/` directory
- **Database**: D1 database with migrations in `functions/migrations/`
- **Auth**: Forge invocation token (RS256) validated via `functions/utils/authenticate.ts`
- **Key Endpoints**:
  - `/forge-custom-content` - Custom content management (Forge OAuth)
  - `/forge-installed` - Forge install/upgrade lifecycle handler
  - `/forge-user-behavior` - Forge trigger event handler
  - `/diagram-likes/` - Diagram like/unlike functionality
  - `/attachment` - File attachment handling
  - `/api/space-status` - License/payment status check

### Content Management
The app uses custom content (V2 API) for diagram persistence:
- **CustomContentStorageProvider** - Stores data as Confluence custom content
- **CompositeContentProvider** - Combines multiple providers with fallback chain

### Key Models
- **Diagram** - Core diagram model with content and metadata
- **ContentProvider** - Abstract interface for data persistence
- **ApWrapper2** - Forge API wrapper for Confluence operations
- **forgeGlobal** - Runtime context (`@forge/bridge` view, context, environment detection)

## Product Variants

The add-on comes in three variants:
- **Full Version** (`PRODUCT_TYPE=full`) - All features enabled
- **Lite Version** (`PRODUCT_TYPE=lite`) - Reduced feature set (free)
- **Diagramly** (`PRODUCT_TYPE=diagramly`) - Diagramly-branded variant

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

## Integration Testing

1. Run `pnpm start:sit` to start both frontend and backend
2. Use `pnpm forge:tunnel` to expose via Forge tunnel
3. Test functionality in a Confluence instance

## Key Dependencies

- **@zenuml/core** - Core ZenUML rendering engine
- **@forge/bridge** - Forge Custom UI bridge (requestConfluence, invokeRemote, view)
- **@forge/api** - Forge API runtime
- **mermaid** - Mermaid diagram rendering
- **swagger-ui** - OpenAPI/Swagger rendering
- **codemirror** - Code editor functionality
- **vue** - Frontend framework
- **@sentry/cloudflare** - Error tracking
- **jose** - JWT verification (Forge invocation tokens)

## File Structure Notes

- `src/` - Frontend source code
- `functions/` - Cloudflare Workers backend
- `public/` - Static assets and DrawIO integration
- `manifest.yml` - Forge app manifest
- `tests/` - Unit and E2E tests
- `docs/` - Project documentation
