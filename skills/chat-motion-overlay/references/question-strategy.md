# Question Strategy

Use this policy when the user triggers `$chat-motion-overlay` without enough detail.

## Principle

Ask only for decisions that materially change the result. Infer the rest.

## Default Behavior

- Infer `container=wechat` when the user says "WeChat chat" or gives a WeChat-like screenshot.
- Infer `avatarMode=preset` when no avatar preference is given.
- For screenshot inputs, use visible avatars to help count and group participants, but use preset render avatars unless the user asks for custom or screenshot-derived avatars.
- Infer `deviceFrame=iphone-dynamic-island` only when the user explicitly asks for a phone frame or the prior context strongly implies phone mockup output.
- Infer `nicknameMode=hidden` for one-to-one chat clips unless the user asks to preserve identity or the content is clearly a group chat proof scene.
- Infer `deliveryFormat=mov` when the user says they want to use the result in editing software or says "transparent video clip".

## When To Ask

Ask when any of these are missing and would significantly change the output:

1. Container style
2. Avatar source
3. Device frame presence
4. Delivery format
5. Nickname display mode

## Preferred User-Facing Questions

### Delivery format

Ask:

- `MOV (transparent background, drop directly into Jianying / Premiere / FCP as an overlay)`
- `WebM (transparent background, suited to web/browser playback)`
- `Remotion project (suited to continued editing and assembly)`
- `Hyperframe project (suited to reuse as a module)`
- `JSON data (suited to programmatic processing / custom rendering)`
- `Preview image / preview project (suited to confirming the look first)`

Do not ask with internal terms such as `mov-alpha`, `json-spec`, or `hyperframe-ready`.

### Container style

Ask:

- `Plain chat bubbles only`
- `WeChat`
- `Telegram`
- `Messenger`

### Avatar source

Ask:

- `Preset avatars`
- `Upload avatars`
- `Some participants upload avatars`

For screenshot inputs, phrase the default clearly:

- `Use preset avatars by default (more reliable)`
- `I'll provide avatar images`
- `Try cropping avatars from the screenshot (may be inaccurate)`

### Device frame

Ask:

- `No phone frame`
- `iPhone Dynamic Island frame`

### Nickname mode

Ask:

- `Don't show nickname`
- `Show nickname on first appearance`
- `Show nickname on every message`

## Question Limits

- Ask at most 3 items in one turn.
- If more than 3 items are missing, ask for the highest-impact ones first:
  1. delivery format
  2. container style
  3. avatar source

## If The User Does Not Care

If the user responds with "whatever", "just use the defaults", or equivalent:

- continue with defaults
- list the chosen defaults briefly in the result
