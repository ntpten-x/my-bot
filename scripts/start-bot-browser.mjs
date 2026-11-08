import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserPlan, findBrowser } from './lib/bot-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const input = process.argv.slice(2);
  let url, explicit, check = false;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '--help') {
      console.log('npm run browser:bot -- [--url https://your-app.example] [--chrome /path/to/chrome] [--check]\nLaunches a separate persistent Chrome profile. Does not install extensions, log in, change automation settings, or prevent desktop throttling.');
      process.exit(0);
    }
    if (input[i] === '--check') { check = true; continue; }
    if (['--url', '--chrome'].includes(input[i]) && input[i + 1] && !input[i + 1].startsWith('--')) {
      const flag = input[i++]; if (flag === '--url') url = input[i]; else explicit = input[i]; continue;
    }
    throw new Error('Unknown or incomplete option. Use --help.');
  }
  const plan = browserPlan({ root, url });
  const executable = await findBrowser(process.platform, process.env, explicit || process.env.MYBOT_CHROME_PATH);
  if (!executable) throw new Error('Chrome was not found. Install Chrome or specify --chrome with its executable path.');
  if (check) {
    console.log('PASS: Chrome and graphical desktop are available. App/database/pairing/Facebook login still require separate checks.');
  } else {
    await mkdir(plan.profile, { recursive: true, mode: 0o700 });
    const child = spawn(executable, plan.args, { cwd: root, detached: true, stdio: 'ignore', shell: false });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    console.log(`Opened the MY-BOT browser profile for ${plan.origin}. First use: log in to Facebook, load extension/, then pair this device. Keep the bot desktop awake and browser visible. Existing automation settings were not changed.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not launch the bot browser.');
  process.exitCode = 1;
}
