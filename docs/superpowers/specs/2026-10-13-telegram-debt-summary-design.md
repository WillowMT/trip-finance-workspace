# Telegram debt-summary image

## Goal

A connected Telegram chat can request one current, shareable image that lists every outstanding, directed debt in its linked Trip Finance workspace. The feature is read-only: it never creates, edits, archives, or offsets ledger records.

## Interaction

- `/start` keeps its existing browser-navigation grid and adds a final full-width `📊 Send debt summary` button for each linked workspace.
- The button uses Telegram `callback_data`, scoped to an opaque per-connection action token. It does not expose a workspace capability secret or a database id.
- On tap, the Worker verifies that the chat still has that enabled connection, queries current active transactions, nets reciprocal positions independently for each currency, renders one image, and sends it to that same chat with a short emoji-led caption.
- The image title is the workspace name. Lines are grouped under each debtor and read `Debtor owes Creditor · USD 12.34`. Only positive remaining positions are shown. An empty workspace gets a `✅ All settled` image rather than an empty ledger list.

## Rendering

Cloudflare Workers has no native raster text renderer and the Bot API photo endpoint needs a raster image. A small deterministic in-repository PNG encoder and bitmap glyph set renders the compact card image without a third-party service, package, browser, or secret. It uses only ledger labels and formatted amounts. The generated PNG is sent as multipart `sendPhoto` data; it is never stored in D1, R2, logs, or an outbox.

## Safety and limits

- Incoming `callback_query` updates are authenticated through the existing webhook-secret check.
- Callback data contains an opaque, short-lived action token keyed by the existing connection id; expired, disabled, or mismatched actions answer with an emoji-led retry message.
- Each tap re-queries the ledger, so the summary is current.
- The line list is capped at a readable image height. If it exceeds the cap, the image includes a `+N more` indicator and Telegram receives an accompanying text line stating that the browser has the complete ledger.
- The button only works for connected active workspaces. A chat with no connection retains the existing welcome message.

## Tests

- Extend the fake Bot API to capture `sendPhoto` multipart requests and callback acknowledgements.
- Assert a `/start` menu contains the callback button without a capability URL.
- Seed reciprocal and cross-currency transactions; assert the image request is one photo, targets the invoking chat, and carries a PNG payload with expected dimensions/signature.
- Assert disabled/expired/mismatched callbacks send no image and provide the standard emoji-led recovery message.
- Assert an all-settled workspace still returns one readable summary image.

## Scope

This does not alter the schema, ledger calculations, notification outbox, automatic announcements, pairing, or browser navigation links.