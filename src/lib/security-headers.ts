/** Request-specific nonces allow Next hydration without permitting arbitrary inline scripts. */
export function securityHeaders(production = process.env.NODE_ENV === "production", nonce?: string) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Content-Security-Policy": [
      "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
      `script-src 'self'${nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ""}${production ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
      "font-src 'self' data:", `connect-src 'self'${production ? "" : " ws: wss:"}`,
    ].join("; "),
  };
}
