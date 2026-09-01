import type { ChildProcess } from "node:child_process";

/** Close stdio and SIGKILL so the Node event loop can exit. */
export async function disposeChild(child: ChildProcess | null): Promise<void> {
	if (!child) return;
	try {
		child.stdin?.destroy();
	} catch {
		// ignore
	}
	try {
		child.stdout?.destroy();
	} catch {
		// ignore
	}
	try {
		child.stderr?.destroy();
	} catch {
		// ignore
	}
	if (child.exitCode !== null || child.signalCode !== null) return;

	await new Promise<void>((resolve) => {
		const finish = () => resolve();
		child.once("exit", finish);
		try {
			child.kill("SIGKILL");
		} catch {
			finish();
			return;
		}
		setTimeout(finish, 1000).unref();
	});
}
