# Ralph Fix Plan

## High Priority

- [x] Fix TypeScript type errors in Conversations.tsx (sessions typed as `never[]`)
- [ ] Fix TypeScript type errors in forge entry points (Diagram | {} assignments)

## Medium Priority

- [ ] Add ESLint config (eslint.config.js) for ESLint v9 compatibility
- [ ] Fix implicit `any` types in forge-embed-viewer.ts and forge-swagger-ui.ts

## Low Priority

- [ ] Clean up Vue 3 compatibility warnings in Editor.spec.ts

## Completed
- [x] Project enabled for Ralph
- [x] Codebase review - 144 unit tests passing, ~134 TS errors (mostly pre-existing)

## Notes
- Focus on MVP functionality first
- Ensure each feature is properly tested
- Update this file after each major milestone
- The `public/drawio/` directory is third-party code — do not modify
- The BASE_URL → BACKEND_API_BASE_URL rename is in-progress (user's work, don't touch)
