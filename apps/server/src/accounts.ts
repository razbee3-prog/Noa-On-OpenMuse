import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export const ADMIN_OWNER = "local-user";
const APPLE_ISSUER = "https://appleid.apple.com";
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface Account {
  id: string;
  provider: "apple" | "access-key";
  displayName: string;
  email?: string;
  createdAt: string;
  invitedWith?: string;
}
interface Invite {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy: string | null;
  usedAt?: string;
}
export type AppleVerifier = (identityToken: string) => Promise<{ sub: string; email?: string }>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Owner IDs are opaque so Apple's user ID never appears in paths, labels or logs. */
export const appleOwnerId = (appleUserId: string) =>
  `apple-${sha256(`apple:${appleUserId}`).slice(0, 40)}`;

export function appleVerifier(
  audiences: string[],
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`)),
): AppleVerifier {
  return async (identityToken) => {
    if (!audiences.length) throw new AppError("Sign in with Apple is not configured", 503);
    try {
      const { payload } = await jwtVerify(identityToken, keys, {
        issuer: APPLE_ISSUER,
        audience: audiences,
        algorithms: ["RS256"],
      });
      if (typeof payload.sub !== "string" || !payload.sub) throw new Error("missing subject");
      return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Apple sign-in could not be verified. Try again.", 401);
    }
  };
}

export class Accounts {
  constructor(
    private readonly db: Store,
    config: Config,
    private readonly verifyApple: AppleVerifier = appleVerifier(config.appleAudiences ?? []),
  ) {}
  get(owner: string) {
    return this.db.get<Account>("system", "accounts", owner);
  }
  /** Verifies Apple's identity token and returns the owner, creating the account only with a valid invite. */
  async signInWithApple(input: { identityToken: string; inviteCode?: string; fullName?: string }) {
    const identity = await this.verifyApple(input.identityToken);
    const owner = appleOwnerId(identity.sub);
    const existing = await this.get(owner);
    if (existing) return existing;
    if (!input.inviteCode?.trim())
      throw new AppError("An invite code is required to create an account.", 403);
    const inviteId = sha256(normalizeInvite(input.inviteCode));
    const invite = await this.db.get<Invite>("system", "invites", inviteId);
    if (!invite || invite.usedBy || Date.parse(invite.expiresAt) <= Date.now())
      throw new AppError("That invite code is invalid or has already been used.", 403);
    const claimed = await this.db.compareAndSwap<Invite>(
      "system",
      "invites",
      inviteId,
      { usedBy: null },
      { usedBy: owner, usedAt: new Date().toISOString() },
    );
    if (!claimed) throw new AppError("That invite code is invalid or has already been used.", 403);
    const account: Account = {
      id: owner,
      provider: "apple",
      displayName: input.fullName?.trim().slice(0, 80) || "Noa user",
      email: identity.email,
      createdAt: new Date().toISOString(),
      invitedWith: inviteId.slice(0, 12),
    };
    return (await this.db.insertIfAbsent("system", "accounts", account)) ?? account;
  }
  async ensureAdmin() {
    const account: Account = {
      id: ADMIN_OWNER,
      provider: "access-key",
      displayName: "Admin",
      createdAt: new Date().toISOString(),
    };
    return (
      (await this.db.insertIfAbsent("system", "accounts", account)) ?? (await this.get(ADMIN_OWNER))
    );
  }
  async displayName(owner: string) {
    return (await this.get(owner))?.displayName ?? "Noa user";
  }
  async rename(owner: string, displayName: string) {
    const account = await this.get(owner);
    if (!account) throw new AppError("Account not found", 404);
    const next = { ...account, displayName: displayName.trim().slice(0, 80) };
    await this.db.put("system", "accounts", next);
    return next;
  }
  async createInvite(createdBy: string) {
    const code = formatInvite(randomBytes(10));
    const now = Date.now();
    await this.db.put<Invite>("system", "invites", {
      id: sha256(normalizeInvite(code)),
      createdBy,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
      usedBy: null,
    });
    return { code, expiresAt: new Date(now + INVITE_TTL_MS).toISOString() };
  }
  async listInvites() {
    return (await this.db.list<Invite>("system", "invites"))
      .map(({ id, createdAt, expiresAt, usedBy, usedAt }) => ({
        id: id.slice(0, 12),
        createdAt,
        expiresAt,
        used: Boolean(usedBy),
        usedAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function formatInvite(bytes: Buffer) {
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return `NOA-${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}
const normalizeInvite = (code: string) =>
  code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
