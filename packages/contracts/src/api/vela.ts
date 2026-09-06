// Vela (AMR) sign-in projection — the shape `GET /api/integrations/vela/status`
// returns.
//
// These types used to live only in `apps/web/src/providers/daemon.ts`, where
// they were a web-private restatement of what the daemon already returns. That
// made the route's response shape a thing two sides agreed on by convention
// rather than by contract, which is exactly what `packages/contracts` exists to
// prevent (AGENTS.md, "Boundary constraints").

/** The signed-in account's identity, as stored in the vela config profile. */
export interface VelaUser {
  id: string;
  email: string;
  name?: string;
  image?: string | null;
  plan?: string;
  /** Wallet balance (USD, string) from the live account projection; `null` when unknown. */
  balanceUsd?: string | null;
}

/**
 * Live billing projection (plan tier + wallet balance) for the signed-in
 * account, carried on its OWN field rather than on {@link VelaUser} so
 * env-backed sessions (where `user` is null) can show plan/balance without a
 * fabricated identity.
 *
 * Absent means unknown — the billing read has not settled, failed, or was
 * abandoned at the status route's answer budget. Callers hide the fields.
 */
export interface VelaLiveAccount {
  plan?: string;
  balanceUsd?: string | null;
}

export interface VelaLoginStatus {
  loggedIn: boolean;
  loginInFlight?: boolean;
  profile: string;
  user: VelaUser | null;
  account?: VelaLiveAccount;
  configPath: string;
  /**
   * Device-authorization URL parsed from `vela login` output while a login is in
   * flight, so the UI can offer a manual sign-in link when the browser did not
   * auto-open.
   */
  activationUrl?: string;
  /** Device-authorization user code printed alongside the activation URL. */
  userCode?: string;
  /** True when vela warned it could not open the browser automatically. */
  browserOpenFailed?: boolean;
}
