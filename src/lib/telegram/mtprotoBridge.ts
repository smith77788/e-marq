/**
 * MTProto Bridge Client — HMAC-signed wrapper навколо зовнішнього Node-сервісу
 * (gramjs/Telethon), що виконує реальні MTProto-запити від імені користувача.
 *
 * Бридж розгортається окремо (Render/Fly/Railway). Цей клієнт знає тільки про
 * HTTPS-API. Жодних raw-TCP/Node-only залежностей у Worker SSR.
 *
 * ENV (server only):
 *   TG_MTPROTO_BRIDGE_URL    — base URL, напр. https://tg-bridge.example.com
 *   TG_MTPROTO_BRIDGE_SECRET — спільний HMAC-секрет
 *   TG_SESSION_ENC_KEY       — base64 32-байтний ключ для AES-GCM шифрування session blobs
 */
import { createHmac, randomBytes, createCipheriv, createDecipheriv } from "crypto";

const BRIDGE_URL = process.env.TG_MTPROTO_BRIDGE_URL;
const BRIDGE_SECRET = process.env.TG_MTPROTO_BRIDGE_SECRET;
const SESSION_ENC_KEY = process.env.TG_SESSION_ENC_KEY;

export type BridgeError = {
  ok: false;
  code:
    | "bridge_not_configured"
    | "bridge_unreachable"
    | "bridge_unauthorized"
    | "bridge_error"
    | "phone_invalid"
    | "code_invalid"
    | "password_required"
    | "password_invalid"
    | "flood_wait"
    | "session_expired";
  message: string;
  retry_after_seconds?: number;
};

export type BridgeOk<T> = { ok: true } & T;
export type BridgeResult<T> = BridgeOk<T> | BridgeError;

export type SendCodeResult = {
  phone_code_hash: string;
  next_type?: string | null;
  timeout_seconds?: number | null;
};

export type SignInResult = {
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  /** Encrypted session blob, ready to persist у tg_user_sessions.session_enc */
  session_enc: string;
  dc_id: number | null;
};

export type ActionResultEcho = {
  message_id?: number | null;
  posted_url?: string | null;
  meta?: Record<string, unknown>;
};

export type BridgeAction =
  | { type: "send_dm"; peer: string | number; text: string; reply_to?: number | null }
  | { type: "send_comment"; peer: string | number; message_id: number; text: string }
  | {
      type: "reaction";
      peer: string | number;
      message_id: number;
      emoji: string;
      remove?: boolean;
    }
  | {
      type: "report_chat";
      peer: string | number;
      reason: TelegramReportReason;
      message: string;
    }
  | {
      type: "report_message";
      peer: string | number;
      message_ids: number[];
      reason: TelegramReportReason;
      message: string;
    };

export type TelegramReportReason =
  | "spam"
  | "violence"
  | "porno"
  | "child_abuse"
  | "copyright"
  | "geo_irrelevant"
  | "fake"
  | "illegal_drugs"
  | "personal_details"
  | "other";

export function isBridgeConfigured(): boolean {
  return Boolean(BRIDGE_URL && BRIDGE_SECRET && SESSION_ENC_KEY);
}

function signPayload(timestamp: string, body: string): string {
  if (!BRIDGE_SECRET) throw new Error("missing_bridge_secret");
  return createHmac("sha256", BRIDGE_SECRET).update(`${timestamp}.${body}`).digest("hex");
}

async function callBridge<T>(path: string, payload: unknown): Promise<BridgeResult<T>> {
  if (!isBridgeConfigured()) {
    return {
      ok: false,
      code: "bridge_not_configured",
      message:
        "MTProto bridge is not configured. Set TG_MTPROTO_BRIDGE_URL/SECRET and TG_SESSION_ENC_KEY.",
    };
  }
  const body = JSON.stringify(payload ?? {});
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(ts, body);

  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Timestamp": ts,
        "X-Bridge-Signature": signature,
      },
      body,
    });
  } catch (e) {
    return {
      ok: false,
      code: "bridge_unreachable",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 403) {
    return { ok: false, code: "bridge_unauthorized", message: String(json.error ?? "unauthorized") };
  }
  if (!res.ok || json.ok === false) {
    const code = String(json.code ?? "bridge_error") as BridgeError["code"];
    return {
      ok: false,
      code,
      message: String(json.error ?? json.message ?? `HTTP ${res.status}`),
      retry_after_seconds:
        typeof json.retry_after_seconds === "number" ? json.retry_after_seconds : undefined,
    };
  }
  return { ok: true, ...(json as object) } as BridgeOk<T>;
}

// ────────────────────────────── Login flow ──────────────────────────────

export function sendCode(input: {
  tenant_id: string;
  phone: string;
}): Promise<BridgeResult<SendCodeResult>> {
  return callBridge<SendCodeResult>("/v1/auth/send-code", input);
}

export function signIn(input: {
  tenant_id: string;
  phone: string;
  phone_code_hash: string;
  code: string;
  password?: string;
}): Promise<BridgeResult<SignInResult>> {
  return callBridge<SignInResult>("/v1/auth/sign-in", input);
}

export function logOut(input: {
  tenant_id: string;
  session_enc: string;
}): Promise<BridgeResult<Record<string, never>>> {
  return callBridge<Record<string, never>>("/v1/auth/logout", input);
}

export function whoAmI(input: {
  tenant_id: string;
  session_enc: string;
}): Promise<BridgeResult<{ user_id: number; username: string | null; first_name: string | null }>> {
  return callBridge("/v1/auth/whoami", input);
}

// ─────────────────────────────── Actions ────────────────────────────────

export function executeAction(input: {
  tenant_id: string;
  session_enc: string;
  action: BridgeAction;
}): Promise<BridgeResult<ActionResultEcho>> {
  return callBridge<ActionResultEcho>("/v1/actions/execute", input);
}

// ───────────────────── AES-GCM helper for session blobs ─────────────────────
// Бридж повертає вже-зашифрований blob (session_enc) — ми нічого не дешифруємо.
// Однак при потребі (наприклад, перенести між середовищами) можна wrap/unwrap.

function loadKey(): Buffer {
  if (!SESSION_ENC_KEY) throw new Error("missing_session_enc_key");
  const buf = Buffer.from(SESSION_ENC_KEY, "base64");
  if (buf.length !== 32) throw new Error("session_enc_key_must_be_32_bytes_base64");
  return buf;
}

export function encryptSession(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${enc.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptSession(payload: string): string {
  const key = loadKey();
  const [ivB64, encB64, tagB64] = payload.split(".");
  if (!ivB64 || !encB64 || !tagB64) throw new Error("invalid_session_payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
