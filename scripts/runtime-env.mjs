/** Keep both child processes in the same mode, including the production worker. */
export function childEnvironment(parent, production, extra = {}) {
  return { ...parent, ...(production ? { NODE_ENV: "production" } : {}), ...extra };
}
