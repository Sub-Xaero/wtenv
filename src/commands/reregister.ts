import { isRegistered } from "../lib/registry.js";
import { worktreeRoot, worktreeId } from "../lib/git.js";
import { deregister } from "./deregister.js";
import { register } from "./register.js";

interface ReregisterOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
}

export async function reregister(
  name: string | undefined,
  opts: ReregisterOptions = {}
): Promise<void> {
  const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
  const id = worktreeId(cwd);

  if (id && isRegistered(id)) {
    await deregister(name, { cwd, configRoot: opts.configRoot, envFile: opts.envFile });
  }

  await register(name, { ...opts, cwd });
}
