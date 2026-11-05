import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Workflow snippets name `node`, but these fixtures must execute the runtime
// under test. A launcher preserves Bun's normal CLI mode; a node symlink does not.
export async function installNodeLauncher(directory) {
  const executable = join(directory, 'node');
  const quotedRuntime = "'" + process.execPath.replaceAll("'", "'\\''") + "'";
  await writeFile(executable, `#!/bin/bash\nexec ${quotedRuntime} "$@"\n`);
  await chmod(executable, 0o755);
}
