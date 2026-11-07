import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: pnpm link:environment <main worktree path> [--dry-run]";
const CLEAN_USAGE = "Usage: pnpm clean [--dry-run]";
// Ignored env files inside these folders belong to tools or to other worktrees.
const SKIPPED =
  /(^|\/)(node_modules|\.next|\.turbo|\.vercel|\.wrangler|\.cindy-worktrees|dist|\.claude)\//;
const isEnvName = (name) => name.startsWith(".env");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function mainWorktree(cwd) {
  const first = git(cwd, "worktree", "list", "--porcelain").split("\n")[0];
  return realpathSync(first.replace(/^worktree /, ""));
}

function envFiles(main) {
  return git(
    main,
    "ls-files",
    "-z",
    "-o",
    "-i",
    "--exclude-standard",
    "--",
    ":(glob)**/.env*",
  )
    .split("\0")
    .filter((path) => path && !SKIPPED.test(path));
}

function state(source, target) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return "create";
  }
  return stat.isSymbolicLink() && readlinkSync(target) === source
    ? "linked"
    : "conflict";
}

function resolveRoots(mainArg, cwd) {
  const root = realpathSync(git(cwd, "rev-parse", "--show-toplevel").trim());
  const main = realpathSync(mainArg);
  const actualMain = mainWorktree(cwd);
  if (main !== actualMain)
    throw Error(`${main} is not the main worktree of this repo`);
  if (root === main) throw Error("Run this from a linked worktree, not main");
  return { root, main };
}

/** Exit codes: 0 done, 1 an existing file blocks a link, 2 usage error. */
export function linkEnvironment(
  args,
  { cwd = process.cwd(), log = console.log, lstat = lstatSync } = {},
) {
  const flags = args.filter((arg) => arg.startsWith("-"));
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (paths.length !== 1 || flags.some((flag) => flag !== "--dry-run")) {
    log(USAGE);
    return 2;
  }
  let roots;
  try {
    roots = resolveRoots(paths[0], cwd);
  } catch (error) {
    log(`${error.message}\n${USAGE}`);
    return 2;
  }
  const plan = [];
  for (const path of envFiles(roots.main)) {
    const source = join(roots.main, path);
    try {
      lstat(source);
    } catch {
      log(`skipped (missing): ${path}`);
      continue;
    }
    const target = join(roots.root, path);
    plan.push({ path, source, target, state: state(source, target) });
  }
  const conflicts = plan.filter((item) => item.state === "conflict");
  if (conflicts.length) {
    for (const { path } of conflicts)
      log(`blocked: ${path} already exists and is not a link to main`);
    log("Nothing was linked. Move or delete those files first.");
    return 1;
  }
  const dryRun = flags.includes("--dry-run");
  for (const { path, source, target, state: current } of plan) {
    if (current === "linked") {
      log(`already linked: ${path}`);
      continue;
    }
    log(`${dryRun ? "would link" : "linked"}: ${path}`);
    if (dryRun) continue;
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(source, target);
  }
  return 0;
}

/** Exit codes: 0 clean, 1 uncommitted or untracked files, 2 not a git repo. */
export function worktreeClean({ cwd = process.cwd(), log = console.log } = {}) {
  let status;
  try {
    status = git(cwd, "status", "--porcelain", "--untracked-files=all");
  } catch {
    log("Not inside a git worktree");
    return 2;
  }
  if (status) {
    log(status.trimEnd());
    return 1;
  }
  log("Worktree is clean");
  return 0;
}

// Why a path must be kept: it is or holds an .env file, or it holds a git
// repo or worktree (a `.git` file or folder), such as another session's
// worktree under `.claude/worktrees/`. Never follows symlinks, so a link to a
// directory is not searched. Returns null when the path is safe to remove.
function keepReason(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return null;
  }
  const name = basename(path);
  if (name === ".git") return "git repo";
  if (isEnvName(name)) return ".env";
  if (!stat.isDirectory()) return null;
  for (const child of readdirSync(path)) {
    const reason = keepReason(join(path, child));
    if (reason) return reason;
  }
  return null;
}

/**
 * Removes git-ignored files and folders from a LINKED worktree.
 * Exit codes: 0 done, 2 usage error, run in the main worktree, or not a repo.
 */
export function clean(
  args,
  { cwd = process.cwd(), log = console.log } = {},
) {
  if (args.some((arg) => arg !== "--dry-run")) {
    log(CLEAN_USAGE);
    return 2;
  }
  const dryRun = args.includes("--dry-run");
  let root;
  try {
    root = realpathSync(git(cwd, "rev-parse", "--show-toplevel").trim());
    if (root === mainWorktree(cwd)) {
      log("Refusing to clean the main worktree. Run this in a linked worktree.");
      return 2;
    }
  } catch {
    log("Not inside a git worktree");
    return 2;
  }
  const candidates = git(
    root,
    "ls-files",
    "-z",
    "-o",
    "-i",
    "--exclude-standard",
    "--directory",
  )
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replace(/\/$/, ""));
  for (const path of candidates) {
    if (path.split("/").includes(".git")) continue;
    const full = join(root, path);
    const reason = keepReason(full);
    if (reason) {
      log(
        reason === ".env" && isEnvName(basename(path))
          ? `skipped (.env): ${path}`
          : `skipped (contains ${reason}): ${path}`,
      );
      continue;
    }
    if (dryRun) {
      log(`would remove: ${path}`);
      continue;
    }
    if (lstatSync(full).isSymbolicLink()) unlinkSync(full);
    else rmSync(full, { recursive: true, force: true });
    log(`removed: ${path}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  process.exitCode =
    command === "link-environment"
      ? linkEnvironment(args)
      : command === "clean-check"
        ? worktreeClean()
        : command === "clean"
          ? clean(args)
          : 2;
}
