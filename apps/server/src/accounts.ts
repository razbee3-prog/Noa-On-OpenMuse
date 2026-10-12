import { createHash } from "node:crypto";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

export const ADMIN_OWNER = "local-user";
const APPLE_ISSUER = "https://appleid.apple.com";

export interface Account {
  id: string;
  provider: "apple" | "access-key";
  displayName: string;
  email?: string;
  createdAt: string;
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
  /** Verifies Apple's identity token and returns the owner, creating the account on first sign-in. */
  async signInWithApple(input: { identityToken: string; fullName?: string }) {
    const identity = await this.verifyApple(input.identityToken);
    const owner = appleOwnerId(identity.sub);
    const existing = await this.get(owner);
    if (existing) return existing;
    const account: Account = {
      id: owner,
      provider: "apple",
      displayName: input.fullName?.trim().slice(0, 80) || "Noa user",
      email: identity.email,
      createdAt: new Date().toISOString(),
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
}
