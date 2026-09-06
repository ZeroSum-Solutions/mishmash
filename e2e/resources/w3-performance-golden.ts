// A verbatim recording of the daemon's opt-in request-timing capture
// (`apps/daemon/src/http/request-timing-log.ts`), kept so
// `tests/w3-performance-proof.test.ts` parses the row shape the daemon actually
// writes rather than one somebody typed (D-18: no invented wire).
//
// It carries what a hand-written fixture would have left out: the Express 5
// `*splat` route spellings, a 400, two 404s, and — since the capture became an
// ATTEMPT journal — the `start` line every request writes on arrival plus one
// attempt whose client aborted, terminal status 0. Those are the rows a capture
// must keep rather than drop. Do not hand-edit it; its whole value is that no
// hand wrote it. Re-record it the same way when the row shape changes.
//
// Recorded 2026-09-05 against the attempt-journal daemon on darwin/arm64:
//
//   OD_DATA_DIR=<scratch> OD_REQUEST_TIMING_LOG=1 pnpm tools-dev start web \
//     --namespace gauntlet-w3-3a --daemon-port 20311 --web-port 20312
//   # one GET to /api/agents aborted after 20 ms, then three times over,
//   # one GET per bar route:
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
{"phase":"start","id":"ba352d71-3","method":"GET","route":"/api/agents","atUtc":"2026-09-06T00:44:51.679Z"}
{"phase":"end","id":"ba352d71-3","method":"GET","route":"/api/agents","status":0,"durationMs":69,"atUtc":"2026-09-06T00:44:51.749Z"}
{"phase":"start","id":"ba352d71-4","method":"GET","route":"/api/agents","atUtc":"2026-09-06T00:44:51.749Z"}
{"phase":"end","id":"ba352d71-4","method":"GET","route":"/api/agents","status":200,"durationMs":4107,"atUtc":"2026-09-06T00:44:55.857Z"}
{"phase":"start","id":"ba352d71-5","method":"GET","route":"/api/skills","atUtc":"2026-09-06T00:44:55.860Z"}
{"phase":"end","id":"ba352d71-5","method":"GET","route":"/api/skills","status":200,"durationMs":41,"atUtc":"2026-09-06T00:44:55.902Z"}
{"phase":"start","id":"ba352d71-6","method":"GET","route":"/api/design-systems","atUtc":"2026-09-06T00:44:55.904Z"}
{"phase":"end","id":"ba352d71-6","method":"GET","route":"/api/design-systems","status":200,"durationMs":55,"atUtc":"2026-09-06T00:44:55.959Z"}
{"phase":"start","id":"ba352d71-7","method":"GET","route":"/api/prompt-templates","atUtc":"2026-09-06T00:44:55.960Z"}
{"phase":"end","id":"ba352d71-7","method":"GET","route":"/api/prompt-templates","status":200,"durationMs":12,"atUtc":"2026-09-06T00:44:55.973Z"}
{"phase":"start","id":"ba352d71-8","method":"GET","route":"/api/recent-dirs","atUtc":"2026-09-06T00:44:55.974Z"}
{"phase":"end","id":"ba352d71-8","method":"GET","route":"/api/recent-dirs","status":200,"durationMs":1,"atUtc":"2026-09-06T00:44:55.975Z"}
{"phase":"start","id":"ba352d71-9","method":"GET","route":"/api/analytics/config","atUtc":"2026-09-06T00:44:55.976Z"}
{"phase":"end","id":"ba352d71-9","method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:55.977Z"}
{"phase":"start","id":"ba352d71-10","method":"GET","route":"/api/media/config","atUtc":"2026-09-06T00:44:55.977Z"}
{"phase":"end","id":"ba352d71-10","method":"GET","route":"/api/media/config","status":200,"durationMs":10,"atUtc":"2026-09-06T00:44:55.987Z"}
{"phase":"start","id":"ba352d71-11","method":"GET","route":"/api/live-artifacts","atUtc":"2026-09-06T00:44:55.988Z"}
{"phase":"end","id":"ba352d71-11","method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-06T00:44:55.989Z"}
{"phase":"start","id":"ba352d71-12","method":"GET","route":"/api/projects","atUtc":"2026-09-06T00:44:55.989Z"}
{"phase":"end","id":"ba352d71-12","method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:55.990Z"}
{"phase":"start","id":"ba352d71-13","method":"GET","route":"/api/connectors","atUtc":"2026-09-06T00:44:55.990Z"}
{"phase":"end","id":"ba352d71-13","method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-06T00:44:55.993Z"}
{"phase":"start","id":"ba352d71-14","method":"GET","route":"/api/connectors/status","atUtc":"2026-09-06T00:44:55.993Z"}
{"phase":"end","id":"ba352d71-14","method":"GET","route":"/api/connectors/status","status":200,"durationMs":1,"atUtc":"2026-09-06T00:44:55.994Z"}
{"phase":"start","id":"ba352d71-15","method":"GET","route":"/api/connectors/discovery","atUtc":"2026-09-06T00:44:55.995Z"}
{"phase":"end","id":"ba352d71-15","method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":3,"atUtc":"2026-09-06T00:44:55.998Z"}
{"phase":"start","id":"ba352d71-16","method":"GET","route":"/api/integrations/vela/status","atUtc":"2026-09-06T00:44:55.998Z"}
{"phase":"end","id":"ba352d71-16","method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:55.999Z"}
{"phase":"start","id":"ba352d71-17","method":"GET","route":"/api/integrations/vela/message-center/messages","atUtc":"2026-09-06T00:44:56.000Z"}
{"phase":"end","id":"ba352d71-17","method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.000Z"}
{"phase":"start","id":"ba352d71-18","method":"GET","route":"/api/agents","atUtc":"2026-09-06T00:44:56.000Z"}
{"phase":"end","id":"ba352d71-18","method":"GET","route":"/api/agents","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.001Z"}
{"phase":"start","id":"ba352d71-19","method":"GET","route":"/api/skills","atUtc":"2026-09-06T00:44:56.001Z"}
{"phase":"end","id":"ba352d71-19","method":"GET","route":"/api/skills","status":200,"durationMs":26,"atUtc":"2026-09-06T00:44:56.028Z"}
{"phase":"start","id":"ba352d71-20","method":"GET","route":"/api/design-systems","atUtc":"2026-09-06T00:44:56.029Z"}
{"phase":"end","id":"ba352d71-20","method":"GET","route":"/api/design-systems","status":200,"durationMs":48,"atUtc":"2026-09-06T00:44:56.078Z"}
{"phase":"start","id":"ba352d71-21","method":"GET","route":"/api/prompt-templates","atUtc":"2026-09-06T00:44:56.078Z"}
{"phase":"end","id":"ba352d71-21","method":"GET","route":"/api/prompt-templates","status":200,"durationMs":5,"atUtc":"2026-09-06T00:44:56.084Z"}
{"phase":"start","id":"ba352d71-22","method":"GET","route":"/api/recent-dirs","atUtc":"2026-09-06T00:44:56.085Z"}
{"phase":"end","id":"ba352d71-22","method":"GET","route":"/api/recent-dirs","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.085Z"}
{"phase":"start","id":"ba352d71-23","method":"GET","route":"/api/analytics/config","atUtc":"2026-09-06T00:44:56.085Z"}
{"phase":"end","id":"ba352d71-23","method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.085Z"}
{"phase":"start","id":"ba352d71-24","method":"GET","route":"/api/media/config","atUtc":"2026-09-06T00:44:56.086Z"}
{"phase":"end","id":"ba352d71-24","method":"GET","route":"/api/media/config","status":200,"durationMs":8,"atUtc":"2026-09-06T00:44:56.094Z"}
{"phase":"start","id":"ba352d71-25","method":"GET","route":"/api/live-artifacts","atUtc":"2026-09-06T00:44:56.095Z"}
{"phase":"end","id":"ba352d71-25","method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-06T00:44:56.095Z"}
{"phase":"start","id":"ba352d71-26","method":"GET","route":"/api/projects","atUtc":"2026-09-06T00:44:56.095Z"}
{"phase":"end","id":"ba352d71-26","method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.095Z"}
{"phase":"start","id":"ba352d71-27","method":"GET","route":"/api/connectors","atUtc":"2026-09-06T00:44:56.096Z"}
{"phase":"end","id":"ba352d71-27","method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-06T00:44:56.098Z"}
{"phase":"start","id":"ba352d71-28","method":"GET","route":"/api/connectors/status","atUtc":"2026-09-06T00:44:56.098Z"}
{"phase":"end","id":"ba352d71-28","method":"GET","route":"/api/connectors/status","status":200,"durationMs":1,"atUtc":"2026-09-06T00:44:56.099Z"}
{"phase":"start","id":"ba352d71-29","method":"GET","route":"/api/connectors/discovery","atUtc":"2026-09-06T00:44:56.099Z"}
{"phase":"end","id":"ba352d71-29","method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":2,"atUtc":"2026-09-06T00:44:56.102Z"}
{"phase":"start","id":"ba352d71-30","method":"GET","route":"/api/integrations/vela/status","atUtc":"2026-09-06T00:44:56.102Z"}
{"phase":"end","id":"ba352d71-30","method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.102Z"}
{"phase":"start","id":"ba352d71-31","method":"GET","route":"/api/integrations/vela/message-center/messages","atUtc":"2026-09-06T00:44:56.103Z"}
{"phase":"end","id":"ba352d71-31","method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.103Z"}
{"phase":"start","id":"ba352d71-32","method":"GET","route":"/api/agents","atUtc":"2026-09-06T00:44:56.103Z"}
{"phase":"end","id":"ba352d71-32","method":"GET","route":"/api/agents","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.104Z"}
{"phase":"start","id":"ba352d71-33","method":"GET","route":"/api/skills","atUtc":"2026-09-06T00:44:56.104Z"}
{"phase":"end","id":"ba352d71-33","method":"GET","route":"/api/skills","status":200,"durationMs":25,"atUtc":"2026-09-06T00:44:56.130Z"}
{"phase":"start","id":"ba352d71-34","method":"GET","route":"/api/design-systems","atUtc":"2026-09-06T00:44:56.130Z"}
{"phase":"end","id":"ba352d71-34","method":"GET","route":"/api/design-systems","status":200,"durationMs":59,"atUtc":"2026-09-06T00:44:56.190Z"}
{"phase":"start","id":"ba352d71-35","method":"GET","route":"/api/prompt-templates","atUtc":"2026-09-06T00:44:56.191Z"}
{"phase":"end","id":"ba352d71-35","method":"GET","route":"/api/prompt-templates","status":200,"durationMs":6,"atUtc":"2026-09-06T00:44:56.197Z"}
{"phase":"start","id":"ba352d71-36","method":"GET","route":"/api/recent-dirs","atUtc":"2026-09-06T00:44:56.197Z"}
{"phase":"end","id":"ba352d71-36","method":"GET","route":"/api/recent-dirs","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.198Z"}
{"phase":"start","id":"ba352d71-37","method":"GET","route":"/api/analytics/config","atUtc":"2026-09-06T00:44:56.198Z"}
{"phase":"end","id":"ba352d71-37","method":"GET","route":"/api/analytics/config","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.198Z"}
{"phase":"start","id":"ba352d71-38","method":"GET","route":"/api/media/config","atUtc":"2026-09-06T00:44:56.198Z"}
{"phase":"end","id":"ba352d71-38","method":"GET","route":"/api/media/config","status":200,"durationMs":7,"atUtc":"2026-09-06T00:44:56.206Z"}
{"phase":"start","id":"ba352d71-39","method":"GET","route":"/api/live-artifacts","atUtc":"2026-09-06T00:44:56.207Z"}
{"phase":"end","id":"ba352d71-39","method":"GET","route":"/api/live-artifacts","status":400,"durationMs":0,"atUtc":"2026-09-06T00:44:56.207Z"}
{"phase":"start","id":"ba352d71-40","method":"GET","route":"/api/projects","atUtc":"2026-09-06T00:44:56.207Z"}
{"phase":"end","id":"ba352d71-40","method":"GET","route":"/api/projects","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.207Z"}
{"phase":"start","id":"ba352d71-41","method":"GET","route":"/api/connectors","atUtc":"2026-09-06T00:44:56.207Z"}
{"phase":"end","id":"ba352d71-41","method":"GET","route":"/api/connectors","status":200,"durationMs":2,"atUtc":"2026-09-06T00:44:56.209Z"}
{"phase":"start","id":"ba352d71-42","method":"GET","route":"/api/connectors/status","atUtc":"2026-09-06T00:44:56.210Z"}
{"phase":"end","id":"ba352d71-42","method":"GET","route":"/api/connectors/status","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.211Z"}
{"phase":"start","id":"ba352d71-43","method":"GET","route":"/api/connectors/discovery","atUtc":"2026-09-06T00:44:56.211Z"}
{"phase":"end","id":"ba352d71-43","method":"GET","route":"/api/connectors/discovery","status":200,"durationMs":1,"atUtc":"2026-09-06T00:44:56.213Z"}
{"phase":"start","id":"ba352d71-44","method":"GET","route":"/api/integrations/vela/status","atUtc":"2026-09-06T00:44:56.214Z"}
{"phase":"end","id":"ba352d71-44","method":"GET","route":"/api/integrations/vela/status","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.214Z"}
{"phase":"start","id":"ba352d71-45","method":"GET","route":"/api/integrations/vela/message-center/messages","atUtc":"2026-09-06T00:44:56.214Z"}
{"phase":"end","id":"ba352d71-45","method":"GET","route":"/api/integrations/vela/message-center/*splat","status":200,"durationMs":0,"atUtc":"2026-09-06T00:44:56.214Z"}
{"phase":"start","id":"ba352d71-46","method":"GET","route":"/api/skills/none/assets/none.png","atUtc":"2026-09-06T00:44:56.215Z"}
{"phase":"end","id":"ba352d71-46","method":"GET","route":"/api/skills/:id/assets/*splat","status":404,"durationMs":117,"atUtc":"2026-09-06T00:44:56.332Z"}
{"phase":"start","id":"ba352d71-47","method":"GET","route":"/api/skills/none/fonts/none.woff2","atUtc":"2026-09-06T00:44:56.332Z"}
{"phase":"end","id":"ba352d71-47","method":"GET","route":"/api/skills/:id/fonts/*splat","status":404,"durationMs":83,"atUtc":"2026-09-06T00:44:56.416Z"}
{"phase":"start","id":"ba352d71-48","method":"GET","route":"/api/projects/none","atUtc":"2026-09-06T00:44:56.416Z"}
{"phase":"end","id":"ba352d71-48","method":"GET","route":"/api/projects/:id","status":404,"durationMs":0,"atUtc":"2026-09-06T00:44:56.417Z"}
`;
