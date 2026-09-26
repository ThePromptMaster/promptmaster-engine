/**
 * Build the Python snapshot the sandbox route boots from (B3).
 *
 *   cd frontend && vercel env pull .env.sandbox && \
 *     node --env-file .env.sandbox --experimental-strip-types scripts/sandbox-snapshot.mts
 *
 * Prints a snapshot id; set it as SANDBOX_SNAPSHOT_ID on the Vercel project.
 * Without it every run installs numpy/scipy/sympy/matplotlib first (~20s);
 * with it a run starts deny-all with the packages already present. Re-run it to
 * change the package set — snapshots are immutable, like workflow templates.
 */

import { Sandbox } from '@vercel/sandbox';

const PACKAGES = ['numpy', 'scipy', 'sympy', 'matplotlib'];

const sandbox = await Sandbox.create({
  runtime: 'python3.13',
  timeout: 300_000,
  networkPolicy: { allow: ['pypi.org', 'files.pythonhosted.org'] },
});
const install = await sandbox.runCommand({ cmd: 'pip', args: ['install', '-q', ...PACKAGES] });
if (install.exitCode !== 0) {
  console.error(await install.stderr());
  await sandbox.stop();
  process.exit(1);
}
const check = await sandbox.runCommand({
  cmd: 'python3',
  args: ['-c', 'import numpy, scipy, sympy, matplotlib; print("ok", numpy.__version__, scipy.__version__)'],
});
console.error(await check.stdout());
// The sandbox stops as part of snapshotting. 0 = never expires.
const snapshot = await sandbox.snapshot({ expiration: 0 });
console.log(snapshot.snapshotId);
