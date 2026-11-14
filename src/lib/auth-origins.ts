export function authOrigins() {
  const url = new URL(process.env.AUTH_URL || "http://localhost:8001");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("AUTH_URL must be an HTTPS origin or local HTTP origin");
  }
  return local ? [...new Set([url.origin, ...["localhost", "127.0.0.1", "[::1]"].map(host => `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`)])] : [url.origin];
}
