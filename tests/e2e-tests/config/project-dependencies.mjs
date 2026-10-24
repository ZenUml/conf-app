/** Shared authority for Playwright execution prerequisites and concrete plans. */
export const PROJECT_DEPENDENCIES = {
  auth: [],
  pages: ['auth'],
  render: ['pages'],
  insert: ['auth'],
  feedback: ['auth'],
  'syntax-validation': ['auth'],
  fullscreen: ['auth'],
  'agent-link': ['auth'],
  asyncapi: ['auth'],
  preview: [],
};
