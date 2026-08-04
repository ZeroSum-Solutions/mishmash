// The OD Library web surface (grid, preview, upload, picker, nav entry,
// `/library` route) ships enabled by default (BUG-6) -- the HTTP, CLI, and
// clipper-ingest surfaces were always fully functional, so hiding only the
// web UI left them unreachable from the product for no product reason. No
// env-var override exists (there was never a config surface behind this
// flag, only a hardcoded boolean); flip this constant directly for a future
// kill-switch need.
export const LIBRARY_UI_VISIBLE = true;
