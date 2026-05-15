import { spawnSync } from "node:child_process";
// Probe whether sudo can be used without prompting in this process.
// - "no-sudo": sudo binary missing
// - "cached": user's sudo timestamp is still valid (sudo -n -v succeeds)
// - "available": NOPASSWD policy lets us run a known wtenv command silently
// - "needs-password": sudo would prompt; headless callers must skip
export function sudoState() {
    if (spawnSync("which", ["sudo"], { stdio: "ignore" }).status !== 0)
        return "no-sudo";
    if (spawnSync("sudo", ["-n", "-v"], { stdio: "ignore" }).status === 0)
        return "cached";
    // Use a wtenv-whitelisted command as a NOPASSWD probe. `mkdir -p` on an existing
    // path is a no-op so it's safe to call as a probe.
    if (spawnSync("sudo", ["-n", "/bin/mkdir", "-p", "/etc/resolver"], { stdio: "ignore" }).status === 0) {
        return "available";
    }
    return "needs-password";
}
// Returns true if a sudo-requiring step can proceed (either NOPASSWD or cached
// credentials). When it returns false, the caller should skip the step gracefully.
export function canSudoSilently() {
    const s = sudoState();
    return s === "available" || s === "cached";
}
// Wraps a sudo-requiring step. Prints a uniform skip warning when sudo isn't
// usable without a prompt, and returns false so the caller can degrade gracefully.
export function requireSudoOrSkip(reason) {
    if (canSudoSilently())
        return true;
    console.warn(`  ${reason} requires sudo — skipping.`);
    console.warn(`    Install passwordless sudo for wtenv with:  wtenv setup --install-sudoers`);
    console.warn(`    or pre-cache credentials with:               sudo -v`);
    return false;
}
// Convenience: run a sudo command non-interactively. Returns true on exit 0.
// Always uses -n so it can never hang waiting for a password.
export function sudoExec(argv, opts = {}) {
    const result = spawnSync("sudo", ["-n", ...argv], { stdio: opts.stdio ?? "inherit" });
    return result.status === 0;
}
