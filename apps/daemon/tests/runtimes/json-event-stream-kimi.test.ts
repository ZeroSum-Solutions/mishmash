import { describe, expect, it } from 'vitest';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';

type StreamEvent = Record<string, unknown>;

function toolResultEventsFor(content: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  const handler = createJsonEventStreamHandler('kimi', (ev) => events.push(ev));
  handler.feed(
    `${JSON.stringify({
      role: 'assistant',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'Read', arguments: '{}' } }],
    })}\n`,
  );
  handler.feed(
    `${JSON.stringify({ role: 'tool', tool_call_id: 'call-1', content })}\n`,
  );
  handler.flush();
  return events.filter((ev) => ev.type === 'tool_result');
}

// NM-33: kimi's `-p --output-format stream-json` `role:'tool'` records carry
// NO structured error field at all (verified: a failed shell command and a
// failed Write both produce a bare {role,tool_call_id,content} shape). The
// one prior signal (kimi's own Bash wrapper appending "Command failed with
// exit code: N.") only covers Bash — every other tool's failure (raw OS/API
// error text: EPERM/ENOENT/EACCES/etc.) parsed as isError:false. C1-10 needs
// this generalized so a failed non-Bash tool call cannot read as clean.
describe('handleKimiEvent tool_result isError detection', () => {
  it('still detects the existing Bash-wrapper failure marker', () => {
    const [result] = toolResultEventsFor('Command failed with exit code: 127.');
    expect(result?.isError).toBe(true);
  });

  it('treats a bare "ok" result as not an error', () => {
    const [result] = toolResultEventsFor('ok');
    expect(result?.isError).toBe(false);
  });

  it('detects raw OS error text from a failed non-Bash tool (EPERM/ENOENT/EACCES)', () => {
    expect(
      toolResultEventsFor("EPERM: operation not permitted, open '/System/protected.txt'")[0]?.isError,
    ).toBe(true);
    expect(
      toolResultEventsFor("ENOENT: no such file or directory, stat '/tmp/missing-xyz'")[0]?.isError,
    ).toBe(true);
    expect(
      toolResultEventsFor("EACCES: permission denied, unlink '/etc/hosts'")[0]?.isError,
    ).toBe(true);
  });

  it('detects the failure tokens case-insensitively', () => {
    expect(toolResultEventsFor("eperm: operation not permitted, open 'x'")[0]?.isError).toBe(true);
    expect(toolResultEventsFor("EnOeNt: no such file or directory, stat 'x'")[0]?.isError).toBe(true);
  });

  it('detects a git-style fatal error', () => {
    expect(
      toolResultEventsFor('fatal: a1b2c3: unable to write new object')[0]?.isError,
    ).toBe(true);
  });

  it('detects a Python-style OSError with an errno', () => {
    expect(toolResultEventsFor('OSError: [Errno 13] Permission denied')[0]?.isError).toBe(true);
  });

  it('detects a generic "exited with status N" failure', () => {
    expect(
      toolResultEventsFor('Error: a1b2c3d4 exited with status 42')[0]?.isError,
    ).toBe(true);
  });

  it('detects a timeout failure', () => {
    expect(
      toolResultEventsFor('TimeoutError: operation timed out after 4500ms (a1b2)')[0]?.isError,
    ).toBe(true);
  });

  it('still detects failures wrapped in extra framing text', () => {
    expect(
      toolResultEventsFor("[tool-error] ENOENT: no such file or directory, stat 'x'")[0]?.isError,
    ).toBe(true);
    expect(
      toolResultEventsFor("EACCES: permission denied, unlink 'x'\nexit status 1")[0]?.isError,
    ).toBe(true);
  });
});
