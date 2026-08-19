// Message Center — the in-app notification panel behind the bell icon.
//
// These shapes used to live only in `apps/web/src/message-center-client.ts`,
// which was possible while the daemon was a pass-through proxy to a vendor
// feed and never had an opinion about the payload. It answers locally now, so
// both sides construct and consume the same objects and the DTO belongs here,
// like every other daemon/web shared shape (AGENTS.md, "Boundary constraints").

export type MessageCenterFilter = 'all' | 'unread' | 'read';

export interface MessageCenterMessage {
  id: string;
  /** `global` reaches everyone; `targeted` was addressed to this recipient. */
  audienceType: 'global' | 'targeted';
  typeName: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  publishedAt: string;
  /** ISO timestamp when the recipient read it, or null while unread. */
  readAt: string | null;
}

/**
 * One page of messages.
 *
 * `nextCursor` is null on the last page. The client walks pages until it is
 * null, so a cursor that does not advance is a protocol error rather than a
 * reason to keep asking.
 */
export interface MessageCenterPage {
  messages: MessageCenterMessage[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * The response for a Message Center with nothing in it.
 *
 * Named rather than inlined because it is the daemon's standing answer: the
 * panel is a local, first-party surface, and until there is a first-party
 * source of messages the honest reply is an empty page, not a relayed one.
 *
 * A factory rather than a shared constant. `messages` is a mutable array, and
 * one shared instance handed to every response is a singleton that a single
 * `.push()` anywhere would corrupt for the rest of the process.
 */
export function emptyMessageCenterPage(): MessageCenterPage {
  return { messages: [], nextCursor: null, unreadCount: 0 };
}
