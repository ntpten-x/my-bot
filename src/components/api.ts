export class ApiError extends Error {}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !url.includes("/api/auth/")) {
    window.location.href = "/login";
    throw new ApiError("กรุณาเข้าสู่ระบบ");
  }
  if (response.status === 403 && data.code === "REAUTH_REQUIRED" && typeof window !== "undefined") window.dispatchEvent(new Event("mybot:reauth-required"));
  if (response.status === 403 && data.code === "MFA_SETUP_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/settings/security") window.location.href = "/settings/security";
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "คำขอไม่สำเร็จ");
  }
  return data as T;
}
