export const DEMO_SOURCE_URL = "https://www.facebook.com/groups/mybot-demo";

export function shouldInsertDemoPosts(input: {
  realSourceCount: number;
  demoExists: boolean;
  demoEnabled: boolean;
  demoPostCount: number;
}) {
  if (input.realSourceCount > 0) return false;
  if (!input.demoExists) return true;
  if (!input.demoEnabled) return false;
  if (input.demoPostCount === 0) return false;
  return false;
}

export function maskSecret(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "••••";
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
}
