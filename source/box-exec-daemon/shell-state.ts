import path from "node:path";

// Persistent foreground-shell state for the box exec daemon.
//
// The Shell tool result promises "Shell state (cwd, env vars) persists for
// subsequent calls", but every call runs in a fresh `sh -lc`. The daemon keeps
// the state in a small directory (cwd + exported env) and wraps each command so
// the saved state is restored before it runs and snapshotted when the shell
// exits. An explicit workingDirectory in the tool call wins over the saved cwd;
// an aborted command resets the state (the formatter then tells the model a new
// shell starts at the project root).

export const SHELL_STATE_DIRNAME = "shell-state";
export const SHELL_STATE_CWD_FILE = "cwd";
export const SHELL_STATE_ENV_FILE = "env.sh";
export const SHELL_STATE_OPTIONS_FILE = "options.sh";
export const SHELL_STATE_ALIASES_FILE = "aliases.sh";
export const SHELL_STATE_FUNCTIONS_FILE = "functions.sh";

// Variables that must not be restored from a previous shell: they describe the
// shell process itself, and a stale PWD would make `pwd` lie.
const VOLATILE_ENV_VARS = ["PWD", "OLDPWD", "SHLVL", "_"];

export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildShellStateWrappedCommand(stateDir: string, command: string, saveDir = stateDir): string {
  const filter = `^(export |declare -x )(${VOLATILE_ENV_VARS.join("|")})(=|$)`;
  // Restore order: shell options (`set +o` output is directly re-inputtable), then
  // aliases (normalized to `alias name=...` lines — dash prints them without the
  // prefix), then functions (bash `typeset -f`; dash cannot dump functions, so the
  // file is empty there), then exported env. Each snapshot mirrors the restore.
  return [
    `__sand_state_dir=${posixQuote(stateDir)}`,
    `__sand_save_dir=${posixQuote(saveDir)}`,
    `mkdir -p "$__sand_save_dir" 2>/dev/null`,
    `if [ -f "$__sand_state_dir/${SHELL_STATE_OPTIONS_FILE}" ]; then . "$__sand_state_dir/${SHELL_STATE_OPTIONS_FILE}" 2>/dev/null; fi`,
    `if [ -f "$__sand_state_dir/${SHELL_STATE_ALIASES_FILE}" ]; then . "$__sand_state_dir/${SHELL_STATE_ALIASES_FILE}" 2>/dev/null; fi`,
    `if [ -f "$__sand_state_dir/${SHELL_STATE_FUNCTIONS_FILE}" ]; then . "$__sand_state_dir/${SHELL_STATE_FUNCTIONS_FILE}" 2>/dev/null; fi`,
    `if [ -f "$__sand_state_dir/${SHELL_STATE_ENV_FILE}" ]; then . "$__sand_state_dir/${SHELL_STATE_ENV_FILE}" 2>/dev/null; fi`,
    `__sand_save_state() {`,
    `  pwd -P > "$__sand_save_dir/cwd.tmp" 2>/dev/null && mv -f "$__sand_save_dir/cwd.tmp" "$__sand_save_dir/${SHELL_STATE_CWD_FILE}" 2>/dev/null`,
    `  set +o > "$__sand_save_dir/options.tmp" 2>/dev/null && mv -f "$__sand_save_dir/options.tmp" "$__sand_save_dir/${SHELL_STATE_OPTIONS_FILE}" 2>/dev/null`,
    `  alias 2>/dev/null | sed '/^alias /!s/^/alias /' > "$__sand_save_dir/aliases.tmp" 2>/dev/null && mv -f "$__sand_save_dir/aliases.tmp" "$__sand_save_dir/${SHELL_STATE_ALIASES_FILE}" 2>/dev/null`,
    `  { typeset -f > "$__sand_save_dir/functions.tmp"; } 2>/dev/null && mv -f "$__sand_save_dir/functions.tmp" "$__sand_save_dir/${SHELL_STATE_FUNCTIONS_FILE}" 2>/dev/null`,
    `  export -p 2>/dev/null | grep -Ev ${posixQuote(filter)} > "$__sand_save_dir/env.tmp" 2>/dev/null`,
    `  mv -f "$__sand_save_dir/env.tmp" "$__sand_save_dir/${SHELL_STATE_ENV_FILE}" 2>/dev/null`,
    `}`,
    `trap __sand_save_state EXIT`,
    command,
  ].join("\n");
}

// Physical path → the logical path the agent uses (`/workspace/...`).
export function toLogicalWorkspacePath(workspaceRoot: string, physicalPath: string): string {
  const relative = path.relative(workspaceRoot, physicalPath);
  if (relative === "") return "/workspace";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return `/workspace/${relative.split(path.sep).join("/")}`;
  return physicalPath;
}

export function isInsideWorkspace(workspaceRoot: string, physicalPath: string): boolean {
  const relative = path.relative(workspaceRoot, physicalPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
