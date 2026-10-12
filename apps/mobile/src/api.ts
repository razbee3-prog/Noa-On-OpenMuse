import { Platform } from "react-native";
import { readApiPayload } from "./api-response";

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787")
).replace(/\/$/, "");

export class MuseApi {
  constructor(readonly token: string) {}
  async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined || body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const payload = await readApiPayload<T>(response);
    return payload;
  }
  url(path: string) {
    return path.startsWith("http") ? path : `${API_URL}${path}`;
  }
}

export interface Session {
  token: string;
  mode: "sample" | "live";
  role?: "admin" | "member";
  expiresAt?: string;
}
async function postSession(path: string, body: unknown): Promise<Session> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readApiPayload<Session>(response, "Could not open your workspace.");
}
export function createSession(accessKey?: string): Promise<Session> {
  return postSession("/api/session", { accessKey });
}
export function createAppleSession(input: {
  identityToken: string;
  fullName?: string;
}): Promise<Session> {
  return postSession("/api/session/apple", input);
}
/** A saved session is kept unless the server explicitly rejects it (offline launches still open). */
export async function sessionStillValid(token: string) {
  try {
    const response = await fetch(`${API_URL}/api/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.status !== 401;
  } catch {
    return true;
  }
}
