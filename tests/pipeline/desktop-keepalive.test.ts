import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it.each(['inactive', 'failed'])('keeps the foreground WSL request alive during service activation and exits on %s without restarting', (terminalState) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mybot-desktop-keepalive-'));
  try {
    const fake = path.join(root, 'systemctl'), calls = path.join(root, 'calls.jsonl');
    writeFileSync(fake, `#!/usr/bin/env node
      const fs=require('node:fs'),args=process.argv.slice(2);
      fs.appendFileSync(process.env.SYNTHETIC_CALLS,JSON.stringify(args)+'\\n');
      if(args.includes('show')){
        let n=0;try{n=Number(fs.readFileSync(process.env.SYNTHETIC_COUNTER))}catch{}
        const states=['activating','active',process.env.SYNTHETIC_TERMINAL];
        console.log(states[Math.min(n,states.length-1)]);
        fs.writeFileSync(process.env.SYNTHETIC_COUNTER,String(n+1));
      }
    `);
    chmodSync(fake, 0o755);
    execFileSync('bash', ['desktop/keepalive.sh'], { timeout: 5000, env: { ...process.env,
      PATH: `${root}:${process.env.PATH}`, MYBOT_KEEPALIVE_INTERVAL: '0.01',
      SYNTHETIC_CALLS: calls, SYNTHETIC_COUNTER: path.join(root, 'count'), SYNTHETIC_TERMINAL: terminalState,
    } });
    const commands = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(commands.filter(args => args.includes('start'))).toEqual([['--user', 'start', 'mybot-workstation.service']]);
    expect(commands.filter(args => args.includes('show'))).toHaveLength(3);
    expect(commands.some(args => args.includes('restart') || args.includes('enable'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
