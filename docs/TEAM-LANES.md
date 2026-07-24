# MishMash — agent lanes & image generation

What the team needs to know to pick an agent and get real imagery into a
build. Operator notes at the bottom.

## Agent lanes

| Agent | Model | Billing | Status |
|---|---|---|---|
| Claude Code (default) | CLI default (config) | Claude Max subscription | Primary lane — use this unless told otherwise |
| Codex CLI | gpt-5.6 family | ChatGPT/Codex subscription | Working alternate |
| Kimi CLI | `moonshotai/kimi-k3` (1M context) | Prepaid Moonshot credits | Working — print-mode adapter |

Pick the agent in the composer's agent selector. For Kimi, the model
dropdown lists **Kimi K3**; the CLI's own default is already K3, so
"Default" also resolves to it.

Kimi caveats:
- The adapter runs Kimi in print mode (one shot per turn). Mid-turn
  follow-ups start a new turn; that is normal.
- Kimi's fancier ACP integration requires a paid **Kimi Code membership**
  (separate from the Moonshot credits). If one is ever active, run
  `kimi acp --login` and the adapter can be switched back — see
  `apps/daemon/src/runtimes/defs/kimi.ts` comments.

## Real images in a build (Higgsfield)

The `higgsfield-imagegen` skill teaches any agent to generate real
photographic imagery (hero shots, product photos, OG images) through the
locally-authenticated `higgsfield` CLI.

- **How to use it:** attach the skill to the run through the skill/template
  picker (or the CLI/API `skillId` param) — naming it by name in the brief's
  prose does NOT attach it. Skills are not auto-discovered by the inner
  agent — if you don't attach it via the picker, the agent may not know it
  exists. (Exception: the Claude lane on this machine also has a global
  Higgsfield skill installed, so it can usually generate images even
  without the attachment.)
- **Cost discipline (from the skill, repeated here):** drafts use
  `gpt_image_2 --quality low --resolution 1k` (~0.5 credits per image);
  1–3 images per site draft, not one per section. Final-art upgrades only
  on explicit request.
- **If generation fails with an auth error:** run `higgsfield auth login`
  in a terminal and retry. Do not paste tokens anywhere.

## Operator notes

- Kimi CLI config: `kimi provider catalog add moonshotai --default-model
  kimi-k3` with the key supplied via `KIMI_REGISTRY_API_KEY` env at call
  time. ZS Vault (`moonshot_api_key`) is the source of truth for the key —
  but the `kimi` CLI persists its own copy into `~/.kimi-code/config.toml`
  (`[providers.moonshotai].api_key`, verified) once the provider is added,
  same class of local credential copy as Higgsfield's `credentials.json`.
  Rotating the key in the vault does NOT update the CLI's copy — rotation
  means re-running `kimi provider catalog add` with the new value. Verify
  with `kimi provider list` and a `kimi -p` smoke test.
- Server-side model pin: set `KIMI_DEFAULT_MODEL=moonshotai/kimi-k3` in the
  daemon's environment (launchd plist on the mini) to pin the fallback
  default without touching per-install app config. This only takes effect
  when a run has no model at all — `resolveModelForAgent`
  (`apps/daemon/src/runtimes/models.ts:81`) returns an explicit `'default'`
  choice straight through without consulting the env var, so a run that has
  already resolved (or persisted) `'default'` ignores this pin. In practice
  that rarely matters here: `kimi provider catalog add --default-model
  kimi-k3` above already set `default_model = "moonshotai/kimi-k3"` in
  `~/.kimi-code/config.toml`, so on this machine an explicit "Default" pick
  still lands on K3 via the CLI's own config — the env var mainly matters
  on a host where that CLI-level default hasn't been pinned yet.
- Deep media-provider integration (Higgsfield inside Settings → Media,
  `apps/daemon/src/media/`) is a recorded follow-up, not built yet; the
  skill lane above is the supported path today.
