// Workspace-wide usage aggregate contract (GET /api/usage). The Home topbar
// "Project usage" control lives in EntryShell.tsx -- the Studio home shell,
// where no project is ever open -- so the project-scoped GET
// /api/projects/:id/usage contract can never populate it. This is the same
// cost shape summed across every project instead of one, plus an optional
// account-level credits block. See
// apps/daemon/src/runtimes/usage-tracking.ts's workspaceUsageSummary for the
// pricingVersion honesty discipline this mirrors exactly from
// projectUsageSummary.
import type { AmrWalletSnapshot } from './amrWallet.js';

export type WorkspaceUsagePricingVersion = 'estimated' | 'unavailable' | 'partial';

export interface WorkspaceUsageResponse {
  currency: 'USD';
  /** Real sum of whatever IS priced across every project (0 when nothing is)
   *  -- never null. `pricingVersion` is the sole confidence signal. */
  totalCostUsd: number;
  pricingVersion: WorkspaceUsagePricingVersion;
  runCount: number;
  pricedRunCount: number;
  projectCount: number;
  /** Account-level AMR wallet balance, or null when unconfigured, signed
   *  out, or unreachable -- a wallet failure must never fake a balance or
   *  block the cost aggregate above from rendering. */
  credits: AmrWalletSnapshot | null;
}
