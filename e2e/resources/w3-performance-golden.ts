// A verbatim recording of the daemon's opt-in request-timing capture
// (`apps/daemon/src/http/request-timing-log.ts`), kept so
// `tests/w3-performance-proof.test.ts` parses the row shape the daemon actually
// writes rather than one somebody typed (D-18: no invented wire).
//
// It carries what a hand-written fixture would have left out: the Express 5
// `*splat` route spellings, a 400, and two 404s — the failure rows a capture
// must keep rather than drop. Do not hand-edit it; its whole value is that no
// hand wrote it. Re-record it the same way when the row shape changes.
//
// Recorded 2026-09-05 against daemon `d3b9bd38b` on darwin/arm64:
//
//   OD_DATA_DIR=<scratch> OD_REQUEST_TIMING_LOG=1 pnpm tools-dev start web \
//     --namespace gauntlet-w3-3a --daemon-port 20311 --web-port 20312
//   # then, three times over, one GET per bar route:
//   #   /api/agents /api/skills /api/design-systems /api/prompt-templates
//   #   /api/recent-dirs /api/analytics/config /api/media/config
//   #   /api/live-artifacts /api/projects /api/connectors /api/connectors/status
//   #   /api/connectors/discovery /api/integrations/vela/status
//   #   /api/integrations/vela/message-center/messages
//   # plus one skill asset, one skill font, and one project detail
//   pnpm tools-dev stop --namespace gauntlet-w3-3a
//   # <scratch>/request-timing/requests.jsonl, pasted below unchanged

/** The recording, one JSON row per line, exactly as the daemon appended it. */
export const W3_REQUEST_TIMING_GOLDEN_JSONL = `
{"method":"GET","route":"/api/health","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:00.464Z"}
{"method":"GET","route":"/api/agents","status":200,"durationMs":3831,"atUtc":"2026-09-05T18:04:11.086Z"}
{"method":"GET","route":"/api/skills","status":200,"durationMs":55,"atUtc":"2026-09-05T18:04:11.154Z"}
{"method":"GET","route":"/api/design-systems","status":200,"durationMs":119,"atUtc":"2026-09-05T18:04:11.282Z"}
{"method":"GET","route":"/api/prompt-templates","status":200,"durationMs":13,"atUtc":"2026-09-05T18:04:11.303Z"}
{"method":"GET","route":"/api/recent-dirs","status":200,"durationMs":1,"atUtc":"2026-09-05T18:04:11.312Z"}
{"method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.320Z"}
{"method":"GET","route":"/api/media/config","status":200,"durationMs":10,"atUtc":"2026-09-05T18:04:11.337Z"}
{"method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-05T18:04:11.345Z"}
{"method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.353Z"}
{"method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:11.362Z"}
{"method":"GET","route":"/api/connectors/status","status":200,"durationMs":1,"atUtc":"2026-09-05T18:04:11.371Z"}
{"method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":3,"atUtc":"2026-09-05T18:04:11.381Z"}
{"method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.390Z"}
{"method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.397Z"}
{"method":"GET","route":"/api/agents","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.405Z"}
{"method":"GET","route":"/api/skills","status":200,"durationMs":29,"atUtc":"2026-09-05T18:04:11.443Z"}
{"method":"GET","route":"/api/design-systems","status":200,"durationMs":49,"atUtc":"2026-09-05T18:04:11.501Z"}
{"method":"GET","route":"/api/prompt-templates","status":200,"durationMs":7,"atUtc":"2026-09-05T18:04:11.516Z"}
{"method":"GET","route":"/api/recent-dirs","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.524Z"}
{"method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.533Z"}
{"method":"GET","route":"/api/media/config","status":200,"durationMs":9,"atUtc":"2026-09-05T18:04:11.550Z"}
{"method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-05T18:04:11.557Z"}
{"method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.565Z"}
{"method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:11.575Z"}
{"method":"GET","route":"/api/connectors/status","status":200,"durationMs":1,"atUtc":"2026-09-05T18:04:11.584Z"}
{"method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:11.594Z"}
{"method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.602Z"}
{"method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.610Z"}
{"method":"GET","route":"/api/agents","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.618Z"}
{"method":"GET","route":"/api/skills","status":200,"durationMs":33,"atUtc":"2026-09-05T18:04:11.659Z"}
{"method":"GET","route":"/api/design-systems","status":200,"durationMs":51,"atUtc":"2026-09-05T18:04:11.718Z"}
{"method":"GET","route":"/api/prompt-templates","status":200,"durationMs":7,"atUtc":"2026-09-05T18:04:11.734Z"}
{"method":"GET","route":"/api/recent-dirs","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.742Z"}
{"method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.751Z"}
{"method":"GET","route":"/api/media/config","status":200,"durationMs":8,"atUtc":"2026-09-05T18:04:11.766Z"}
{"method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-05T18:04:11.774Z"}
{"method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.782Z"}
{"method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:11.792Z"}
{"method":"GET","route":"/api/connectors/status","status":200,"durationMs":1,"atUtc":"2026-09-05T18:04:11.800Z"}
{"method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":2,"atUtc":"2026-09-05T18:04:11.810Z"}
{"method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.818Z"}
{"method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-05T18:04:11.826Z"}
{"method":"GET","route":"/api/skills/:id/assets/*splat","status":404,"durationMs":193,"atUtc":"2026-09-05T18:04:12.027Z"}
{"method":"GET","route":"/api/skills/:id/fonts/*splat","status":404,"durationMs":85,"atUtc":"2026-09-05T18:04:12.122Z"}
{"method":"GET","route":"/api/projects/:id","status":404,"durationMs":0,"atUtc":"2026-09-05T18:04:12.131Z"}
`;
