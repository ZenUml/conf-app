const DIRECTIVE = [
  /^\s*eslint(-disable|-enable|-env)?(\s|$)/,
  /^\s*(global|globals|exported)\s/,
  /^\s*@ts-(ignore|expect-error|nocheck|check)/,
  /^\s*prettier-ignore/,
  /^\s*(istanbul|c8|v8) ignore/,
  /^\s*(@vite-ignore|webpackChunkName|webpackIgnore)/,
  /^\s*[#@]__(PURE|NO_SIDE_EFFECTS)__/,
  /^\s*@(vitest|jest)-environment/,
  /^\/\s*<reference\s/,
  /^[!*]?\s*@(license|preserve)\b/,
];

export function isDirective(comment) {
  const value = comment.type === 'Block' ? comment.value.replace(/^\*\s*/, '') : comment.value;
  return comment.type === 'Shebang' || DIRECTIVE.some((re) => re.test(value));
}

export function prohibitedComments(sourceCode) {
  const template = sourceCode.ast.templateBody?.comments ?? [];
  return [...sourceCode.getAllComments(), ...template].filter((c) => !isDirective(c));
}

export const noCommentsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Ban code comments. Move decisions to docs/adr, file issues for workarounds, and delete the rest (.claude/skills/delete-comment).',
    },
    schema: [],
    messages: {
      comment:
        'Comments are banned: move a decision to docs/adr, file an issue for a workaround, or delete it (see .claude/skills/delete-comment).',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of prohibitedComments(context.sourceCode)) {
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};

export const commentsPlugin = { rules: { 'no-comments': noCommentsRule } };
