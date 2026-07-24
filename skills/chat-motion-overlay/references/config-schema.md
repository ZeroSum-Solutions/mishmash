# Config Schema

Provide a JSON file when the user wants anything beyond the defaults.

## Example

```json
{
  "container": "wechat",
  "avatarMode": "mixed",
  "deviceFrame": "iphone-dynamic-island",
  "nicknameMode": "first-message-only",
  "deliveryFormat": "mov",
  "showTimestamp": true,
  "participants": {
    "Alice": {
      "side": "left",
      "preset": "female-fox-yellow"
    },
    "Bob": {
      "side": "right",
      "preset": "male-penguin-blue",
      "uploadPath": "/path/to/bob-avatar.png"
    }
  }
}
```

## Fields

- `container`
  - `none`: standalone bubbles only
  - `wechat`: WeChat-style UI shell
  - `telegram`: Telegram-like UI shell
  - `messenger`: Facebook Messenger-like UI shell

- `avatarMode`
  - `preset`: use only bundled preset avatars
  - `upload`: require uploaded avatar files for all participants
  - `mixed`: combine preset and uploaded avatars across participants

- `deviceFrame`
  - `none`
  - `iphone-dynamic-island`
  - `container: none` only supports `deviceFrame: none`; phone framing is available for app containers

- `nicknameMode`
  - `hidden`
  - `first-message-only`
  - `always`

- `deliveryFormat`
  - `mov`: `MOV (transparent background, drop directly into Jianying / Premiere / FCP as an overlay)`
  - `webm`: `WebM (transparent background, suited to web/browser playback)`
  - `remotion`: `Remotion project (suited to continued editing and assembly)`
  - `hyperframe`: `Hyperframe project (suited to reuse as a module)`
  - `json`: `JSON data (suited to programmatic processing / custom rendering)`
  - `preview`: `Preview image / preview project (suited to confirming the look first)`

- `showTimestamp`
  - boolean

- `participants`
  - Keys are speaker names from the transcript or screenshot.
  - `side`: `left` or `right`; the same participant must stay on the same side.
  - `preset`: optional bundled preset avatar key.
  - `uploadPath`: optional local avatar file path used during bundle preparation.
  - If omitted, participants are inferred from the transcript and assigned stable preset avatars.
  - In generated bundles, local `uploadPath` values are removed and only copied `uploadAsset` names are retained.

## Preset Avatar Keys

- `female-bunny-pink`
- `female-cat-orange`
- `female-fox-yellow`
- `male-bear-mint`
- `male-penguin-blue`
- `male-koala-lilac`
