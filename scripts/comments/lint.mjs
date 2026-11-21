import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import { commentsPlugin } from './no-comments-rule.mjs';

const vueParser = pluginVue.configs['flat/base'].find((c) => c.languageOptions?.parser).languageOptions.parser;

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/;
const EXCLUDED = /^(vendor|private|public\/drawio|dist)\/|\/generated\/|\.d\.ts$/;

export function sourceFiles(cwd, paths = []) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths], {
    cwd,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => SOURCE.test(f) && !EXCLUDED.test(f));
}

export async function lintComments(cwd, files) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}'],
        plugins: { local: commentsPlugin },
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: { 'local/no-comments': 'error' },
      },
      {
        files: ['**/*.vue'],
        languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser } },
      },
    ],
  });
  const results = await eslint.lintFiles(files);
  return results.map((r) => ({
    file: r.filePath.slice(cwd.length + 1),
    fatal: r.messages.find((m) => m.fatal)?.message,
    comments: r.messages.filter((m) => m.ruleId === 'local/no-comments'),
  }));
}
