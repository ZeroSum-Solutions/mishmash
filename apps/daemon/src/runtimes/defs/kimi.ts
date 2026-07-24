import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const kimiAgentDef = {
    id: 'kimi',
    name: 'Kimi CLI',
    bin: 'kimi',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'kimi-k3', label: 'kimi-k3' },
      { id: 'kimi-k2-turbo-preview', label: 'kimi-k2-turbo-preview' },
      { id: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
      { id: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    ],
    // `kimi acp` is hard-gated behind a paid Kimi Code membership on this
    // class of install ("unable to verify membership benefits", reproduced
    // via a raw ACP `session/new` JSON-RPC call over stdio) — the prior
    // ACP lane (mcpDiscovery: 'mature-acp', externalMcpInjection:
    // 'acp-merge', fetchModels calling `kimi acp` for live model
    // discovery) simply cannot run on an unentitled machine. Print mode
    // (`kimi -p`) works against the configured moonshotai API provider
    // without needing a membership (verified live), so this def now
    // follows deepseek.ts's argv-prompt shape instead. If a Kimi Code
    // membership is active on a future host, the ACP variant can come
    // back as an alternate lane — it is not that ACP is broken, only
    // that it is unreachable without paid entitlement.
    //
    // `kimi -p` runs non-interactively and already auto-approves tool
    // calls on its own (there is no TTY to prompt against). Passing
    // `-y`/`--yolo` or `--auto` alongside `-p` is rejected outright
    // ("error: Cannot combine --prompt with --yolo/--auto" — verified),
    // so no approval flag is passed here.
    buildArgs: (prompt, _imagePaths, _extra, options = {}) => {
      const args = ['-p', prompt, '--output-format', 'stream-json'];
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      return args;
    },
    // `kimi -p` requires the prompt as the argument to `-p` — a literal
    // `-` is NOT treated as a stdin sentinel (verified: it comes through
    // as a literal one-character user message rather than reading
    // stdin), so the prompt has to ride argv like deepseek.ts. Same
    // Windows CreateProcess ~32 KB budget rationale as deepseek's
    // comment.
    maxPromptArgBytes: 30_000,
    // `kimi -p --output-format stream-json` emits OpenAI-chat-completions
    // shaped JSONL (`{role:'assistant',tool_calls:[...]}` /
    // `{role:'tool',tool_call_id,...}` / `{role:'assistant',content:...}`
    // / a trailing `{role:'meta',type:'session.resume_hint',...}`).
    // json-event-stream.ts already has `handleKimiEvent` for this exact
    // shape, so reuse that generic pipeline instead of `streamFormat:
    // 'plain'`.
    streamFormat: 'json-event-stream',
    eventParser: 'kimi',
    // Daemon-process env override for operator pinning of the fallback
    // default model, mirroring amr.ts's VELA_DEFAULT_MODEL. Lets an operator
    // point Kimi at kimi-k3 (or a future default) without a code change.
    defaultModelEnvVar: 'KIMI_DEFAULT_MODEL',
} satisfies RuntimeAgentDef;
