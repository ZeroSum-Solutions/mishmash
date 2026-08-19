import type {
  MessageCenterFilter,
  MessageCenterMessage,
  MessageCenterPage,
} from '@open-design/contracts';

export type { MessageCenterFilter, MessageCenterMessage } from '@open-design/contracts';

// One endpoint, whatever the sign-in state.
//
// There used to be two: signed-in traffic went to the daemon's own
// message-center route, and anonymous traffic went through the generic AMR
// proxy straight to the vendor's feed. Both now read the same local, empty
// data, so the distinction only survived as a way to reach the vendor. The
// generic AMR proxy itself is untouched — the rest of the integration needs it.
const MESSAGE_CENTER_API = '/api/integrations/vela/message-center';
const LEGACY_WINDOW_KEY = 'open-design.message-center.anonymous-started-at.v1';
const MESSAGES_KEY = 'open-design.message-center.anonymous-messages.v1';
const READ_KEY = 'open-design.message-center.anonymous-read-ids.v1';
const MAX_MESSAGE_CENTER_PAGES = 20;

/**
 * Remove every trace of the old locally-cached message feed.
 *
 * The read and write halves of this cache are gone. They existed to keep the
 * vendor's feed available between loads; the feed is local and empty now, so a
 * cache of it has nothing to hold. Only the purge survives, because installs
 * that ran the old build still have those keys on disk.
 */
export function clearAnonymousState(storage: Storage): void {
  storage.removeItem(MESSAGES_KEY);
  storage.removeItem(READ_KEY);
  storage.removeItem(LEGACY_WINDOW_KEY);
}

export async function isAmrLoggedIn(): Promise<boolean> {
  const response = await fetch('/api/integrations/vela/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`AMR status failed: ${response.status}`);
  const payload = (await response.json()) as { loggedIn?: boolean };
  return payload.loggedIn === true;
}

export async function pullMessageCenter(input: {
  locale: string;
  filter?: MessageCenterFilter;
}): Promise<MessageCenterMessage[]> {
  const messages: MessageCenterMessage[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_MESSAGE_CENTER_PAGES) {
      throw new Error('Message Center pagination exceeded max pages');
    }
    const query = new URLSearchParams({
      locale: apiLocale(input.locale),
      filter: input.filter ?? 'all',
      limit: '100',
    });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${MESSAGE_CENTER_API}/messages?${query}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Message Center sync failed: ${response.status}`);
    const page = (await response.json()) as MessageCenterPage;
    if (!Array.isArray(page.messages)) {
      throw new Error('Message Center page missing messages[]');
    }
    if (page.nextCursor && page.nextCursor === cursor) {
      throw new Error('Message Center pagination cursor did not advance');
    }
    messages.push(...page.messages);
    cursor = page.nextCursor;
  } while (cursor);
  return messages;
}

export async function markAccountMessageRead(messageId: string): Promise<void> {
  const response = await fetch(`${MESSAGE_CENTER_API}/messages/${encodeURIComponent(messageId)}/read`, { method: 'POST' });
  if (!response.ok) throw new Error(`Mark message read failed: ${response.status}`);
}

export async function markAllAccountMessagesRead(): Promise<void> {
  const response = await fetch(`${MESSAGE_CENTER_API}/read-all`, { method: 'POST' });
  if (!response.ok) throw new Error(`Mark all messages read failed: ${response.status}`);
}

// Open Design ships English-only; the es-ES/pt-BR mappings were removed in
// the de-bloat pass.
function apiLocale(locale: string): string {
  const mapping: Record<string, string> = { en: 'en-US' };
  return mapping[locale] ?? locale;
}
