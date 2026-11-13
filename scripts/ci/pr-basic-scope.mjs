import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Equivalent to the former PR workflow paths-ignore list. A rename includes
// both paths so moving code to an ignored path cannot hide the old code.
export function ignoredPath(path) {
  return typeof path === 'string' && (path.endsWith('.md')
    || /^(docs|\.claude|\.cursor|packages\/pr-agent-panel|workers\/render-mcp)\//.test(path)
    || path === '.github/workflows/render-mcp-deploy.yml'
    || path === 'scripts/ci/check-render-mcp.mjs'
    || /^scripts\/ci\/wait-for-render-mcp[^/]*$/.test(path));
}

export async function basicScope(readPr, readFiles) {
  try {
    const before = await readPr();
    if (!Number.isSafeInteger(before.changed_files) || before.changed_files < 1 || before.changed_files >= 3000 || !before.head?.sha || !before.base?.sha) throw new Error('invalid PR metadata');
    const files = await readFiles();
    const after = await readPr();
    if (!Array.isArray(files) || files.length !== before.changed_files || after.changed_files !== before.changed_files || after.head?.sha !== before.head.sha || after.base?.sha !== before.base.sha) throw new Error('incomplete or changed PR file list');
    const paths = files.flatMap(file => {
      if (typeof file.filename !== 'string' || !file.filename || (file.status === 'renamed' && (typeof file.previous_filename !== 'string' || !file.previous_filename))) throw new Error('invalid file record');
      return [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])];
    });
    return { run: paths.some(path => !ignoredPath(path)), reason: 'complete PR file list' };
  } catch (error) {
    return { run: true, reason: `file discovery failed: ${error.message}` };
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const repo = process.env.GITHUB_REPOSITORY, pr = process.env.PR_NUMBER;
  const get = async path => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^[1-9][0-9]*$/.test(pr || '')) throw new Error('invalid repository or PR');
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}${path}`, { headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    return response.json();
  };
  const result = await basicScope(() => get(`/pulls/${pr}`), async () => {
    const files = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await get(`/pulls/${pr}/files?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('invalid file page');
      files.push(...batch);
      if (batch.length < 100) return files;
    }
    throw new Error('file list exceeds limit');
  });
  console.log(`Basic checks: ${result.run ? 'run' : 'skip'} (${result.reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${result.run}\n`);
}
