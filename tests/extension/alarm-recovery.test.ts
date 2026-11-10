import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const source = readFileSync('extension/background.js', 'utf8');
it('recreates collection alarms on boot even when stale alarms already exist', async () => {
  const create = vi.fn(async () => {});
  const context = vm.createContext({ chrome: { alarms: {
    create, getAll: async () => [{ name: 'mybot-tasks', periodInMinutes: 0.5 },
      { name: 'mybot-heartbeat', periodInMinutes: 1 }, { name: 'mybot-due' }],
  } } });
  vm.runInContext(source.slice(source.indexOf('function armAlarms('), source.indexOf('chrome.runtime.onInstalled')), context);
  const begin = source.indexOf('void chrome.alarms.getAll()');
  vm.runInContext(source.slice(begin, source.indexOf('\n', begin)), context);
  await new Promise(resolve => setImmediate(resolve));
  expect(create).toHaveBeenCalledWith('mybot-tick', { periodInMinutes: 1 });
  expect(create).toHaveBeenCalledWith('mybot-tasks', { periodInMinutes: 1 });
  expect(create).toHaveBeenCalledWith('mybot-heartbeat', { periodInMinutes: 1 });
  expect(create).not.toHaveBeenCalledWith('mybot-due', expect.anything());
});
