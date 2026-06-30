import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `dev` dispatcher so a single demo covers both bundlers:
//   yarn dev            -> Vite       (ide-byebye Vite adapter)
//   yarn dev --webpack  -> webpack    (ide-byebye webpack adapter)
// Both serve the same demo/src app; only the build pipeline + which adapter is exercised differs.
const dir = path.dirname(fileURLToPath(import.meta.url));
const useWebpack = process.argv.slice(2).includes('--webpack');
const bin = (name) => path.join(dir, 'node_modules', '.bin', name);

const [cmd, args] = useWebpack
  ? [bin('webpack'), ['serve', '--mode', 'development']]
  : [bin('vite'), []];

const child = spawn(cmd, args, { stdio: 'inherit', cwd: dir });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`[demo] failed to launch ${useWebpack ? 'webpack' : 'vite'}:`, err.message);
  process.exit(1);
});
