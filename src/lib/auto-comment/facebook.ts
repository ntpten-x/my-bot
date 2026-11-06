export type FailureKind = "rate" | "permission" | "unavailable" | "transient" | "uncertain" | "permanent";
export class CommentApiError extends Error {
  constructor(readonly kind: FailureKind, message: string, readonly retryAfterMs = 0) { super(message); }
}
type GraphData = Record<string, unknown>;
export type CommentCredentials = { pageId: string; pageToken: string; managerToken: string };
export interface CommentGateway {
  verify(credentials: CommentCredentials): Promise<void>;
  checkPost(credentials: CommentCredentials, postId: string): Promise<void>;
  send(credentials: CommentCredentials, postId: string, message: string): Promise<{ id: string; pauseMs?: number }>;
  posts(credentials: CommentCredentials): Promise<{ id: string; message: string; created_time?: string }[]>;
}
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value) return 15 * 60_000;
  const seconds = Number(value);
  return Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now || 0);
}
function usagePause(headers: Headers) {
  let pause = 0;
  try {
    const check = (usage: Record<string, unknown>) => {
      if ([usage.call_count, usage.total_cputime, usage.total_time].some(value => Number(value) >= 90)) pause = Math.max(pause, 15 * 60_000);
      const regain = Number(usage.estimated_time_to_regain_access);
      if (Number.isFinite(regain) && regain > 0) pause = Math.max(pause, regain * 60_000);
    };
    for (const key of ["x-app-usage", "x-page-usage"]) check(JSON.parse(headers.get(key) || "{}"));
    const business = JSON.parse(headers.get("x-business-use-case-usage") || "{}");
    for (const entries of Object.values(business)) if (Array.isArray(entries)) for (const entry of entries) check(entry);
    return pause;
  } catch { return 15 * 60_000; }
}

/** Fixed official host; no cookies, browser automation, custom endpoints or private APIs. */
export function facebookGateway(options: { appId?: string; appToken?: string; version?: string; fetcher?: typeof fetch } = {}): CommentGateway {
  const version = options.version ?? process.env.FACEBOOK_GRAPH_VERSION ?? "v25.0";
  if (!/^v\d{2}\.0$/.test(version)) throw new CommentApiError("permission", "Graph API version ไม่ถูกต้อง");
  const appId = options.appId ?? process.env.FACEBOOK_APP_ID;
  const appToken = options.appToken ?? process.env.FACEBOOK_APP_ACCESS_TOKEN;
  const request = async (path: string, token: string, method = "GET", params: Record<string, string> = {}) => {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    if (method === "GET") for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(url, {
        method, headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
        ...(method === "POST" ? { body: new URLSearchParams(params) } : {}),
        signal: AbortSignal.timeout(10_000), redirect: "error",
      });
    } catch { throw new CommentApiError(method === "POST" ? "uncertain" : "transient", method === "POST" ? "ไม่ทราบผลการส่ง ต้องตรวจบน Facebook ก่อน ไม่ส่งซ้ำอัตโนมัติ" : "ติดต่อ Meta ไม่สำเร็จ จะลองอ่านใหม่"); }
    const data = await response.json().catch(() => null) as (GraphData & { error?: { code?: number; is_transient?: boolean } }) | null;
    const code = Number(data?.error?.code);
    if (!response.ok || data?.error || !data) {
      // Do not store provider messages/bodies/URLs: they can contain credentials.
      if (response.status === 429 || [4, 17, 32, 613, 80004].includes(code)) throw new CommentApiError("rate", "Meta จำกัดความถี่ จึงพักทั้งระบบ", retryAfter(response.headers.get("retry-after")));
      if ([10, 190, 200, 294, 368].includes(code) || response.status === 401 || response.status === 403) throw new CommentApiError("permission", "Token หรือสิทธิ์ไม่เพียงพอ ต้องตรวจและเปิดระบบใหม่เอง");
      if (response.status === 404 || code === 100 || code === 803) throw new CommentApiError("unavailable", "โพสต์ถูกลบ ไม่สามารถเข้าถึง หรือไม่รองรับ");
      if (method === "POST" && (response.status >= 500 || !data)) throw new CommentApiError("uncertain", "ผลการส่งไม่แน่นอน ไม่ลองส่งซ้ำอัตโนมัติ");
      throw new CommentApiError(response.status >= 500 || data?.error?.is_transient ? "transient" : "permanent", "Meta ปฏิเสธคำขอ");
    }
    const pauseMs = usagePause(response.headers);
    if (pauseMs && method === "GET") throw new CommentApiError("rate", "Meta รายงานการใช้งานใกล้ขีดจำกัด จึงพักก่อนส่ง", pauseMs);
    return { data, pauseMs };
  };
  return {
    async verify(credentials) {
      if (!appId || !appToken || !credentials.pageToken || !credentials.managerToken) throw new CommentApiError("permission", "ยังไม่ได้ตั้ง App ID/App Token, Page Token และ User Token ของผู้จัดการเพจ");
      for (const [token, expectedType, scopes] of [
        [credentials.pageToken, "PAGE", ["pages_read_engagement", "pages_manage_engagement"]],
        [credentials.managerToken, "USER", ["pages_show_list"]],
      ] as const) {
        const { data } = await request("debug_token", appToken, "GET", { input_token: token });
        const debug = data.data as { is_valid?: boolean; app_id?: string; type?: string; scopes?: string[]; expires_at?: number; data_access_expires_at?: number } | undefined;
        if (!debug?.is_valid || String(debug.app_id) !== appId || debug.type !== expectedType || !scopes.every(scope => debug.scopes?.includes(scope))
          || [debug.expires_at, debug.data_access_expires_at].some(expiry => expiry && expiry * 1000 <= Date.now())) throw new CommentApiError("permission", "ตรวจสอบ Token/ขอบเขตสิทธิ์/App/วันหมดอายุไม่ผ่าน");
      }
      const identity = await request("me", credentials.pageToken, "GET", { fields: "id" });
      if (String(identity.data.id) !== credentials.pageId) throw new CommentApiError("permission", "Page Token ไม่ตรงกับเพจใน Allowlist");
      let after = "";
      for (let page = 0; page < 10; page++) {
        const response = await request("me/accounts", credentials.managerToken, "GET", { fields: "id,tasks", limit: "100", ...(after ? { after } : {}) });
        const account = (response.data.data as { id: string; tasks?: string[] }[] | undefined)?.find(row => row.id === credentials.pageId);
        if (account) {
          if (!account.tasks?.some(task => ["MODERATE", "PROFILE_PLUS_MODERATE", "PROFILE_PLUS_FULL_CONTROL"].includes(task))) throw new CommentApiError("permission", "ผู้จัดการไม่มี MODERATE task ของเพจ");
          return;
        }
        const paging = response.data.paging as { next?: string; cursors?: { after?: string } } | undefined;
        if (!paging?.next || !paging.cursors?.after) break;
        after = paging.cursors.after;
      }
      throw new CommentApiError("permission", "ไม่พบเพจที่ได้รับอนุญาตในบัญชีผู้จัดการ");
    },
    async checkPost(credentials, postId) {
      if (!new RegExp(`^${credentials.pageId}_\\d+$`).test(postId)) throw new CommentApiError("unavailable", "Post ID อยู่นอกเพจที่อนุญาต");
      const { data } = await request(postId, credentials.pageToken, "GET", { fields: "id,from,is_published" });
      if (data.id !== postId || (data.from as { id?: string })?.id !== credentials.pageId || data.is_published !== true) throw new CommentApiError("unavailable", "รองรับเฉพาะโพสต์ที่เพจนี้เป็นผู้เผยแพร่และยังเผยแพร่อยู่");
    },
    async send(credentials, postId, message) {
      const { data, pauseMs } = await request(`${postId}/comments`, credentials.pageToken, "POST", { message });
      if (typeof data.id !== "string" || !/^\d+(?:_\d+)?$/.test(data.id)) throw new CommentApiError("uncertain", "Meta ไม่คืน Comment ID ที่ยืนยันได้ ต้องตรวจด้วยมือ");
      return { id: data.id, pauseMs };
    },
    async posts(credentials) {
      const { data } = await request(`${credentials.pageId}/posts`, credentials.pageToken, "GET", { fields: "id,message,created_time", limit: "40" });
      return Array.isArray(data.data) ? data.data as { id: string; message: string; created_time?: string }[] : [];
    },
  };
}
