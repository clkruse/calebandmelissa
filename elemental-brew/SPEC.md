# Elemental Brew — Two-Page Ordering System Spec

## Overview

Split the app into two static pages served from GitHub Pages:

- **`index.html`** — the customer order page (evolves from the current page)
- **`barista.html`** — the barista queue page (new)

There is no database and no server. Orders travel from customer to barista via a
**shareable link / QR code**: placing an order produces a URL that encodes the entire
order. The barista opens that link (scans the QR or taps the texted link) and the order
lands in their queue. The barista page persists its queue in the barista browser's
`localStorage`, so queue state, statuses, and history survive reloads on that device.

```
Customer phone                          Barista phone
--------------                          -------------
Fill out order
Rate + tip (kept as-is)
   ↓
Success screen shows:
  • QR code               ──scan──▶     barista.html#o=<payload>
  • "Share order" button  ──text──▶        ↓
                                        Order added to localStorage queue
                                        Pending → In Progress → Done
```

## Order payload

The order is serialized as JSON, base64url-encoded, and placed in the **hash fragment**
of the barista page URL (`barista.html#o=eyJ...`). Using the hash (not a query string)
keeps payloads out of any logs and avoids URL-length pitfalls in practice (payload is
~200 bytes).

```json
{
  "id": "m9x2ka-4821",          // uniqueness: timestamp base36 + random suffix
  "name": "Melissa",             // free-text customer name
  "coffee": "colombian",         // colombian | breakfast | decaf | water
  "temperature": "hot",          // hot | iced | cold (water)
  "milk": "none",                // none | milk | half-half
  "size": "medium",              // small | medium | large
  "coffeeRating": 5,             // 1–5 (pre-rated, per house tradition)
  "baristaRating": 5,            // 1–5
  "tip": 1.24,                   // dollars
  "placedAt": 1754236800000      // epoch ms
}
```

The `id` is how the barista page deduplicates: opening the same link twice (or
re-scanning the QR) must not create a duplicate order.

## Page 1: `index.html` (customer)

Keep the existing look, flow, and menu. Changes:

1. **Name field** — a required free-text "Who's this for?" input at the top of the order
   section. Remembered in `localStorage` so repeat customers don't retype it.
2. **Order flow unchanged** — coffee → temperature/milk (when applicable) → size →
   Place Order → rating + tip screen (kept exactly as today, ratings required before
   submit).
3. **Success screen becomes the handoff screen.** After submitting ratings it shows,
   in addition to the current order summary:
   - A **QR code** encoding the full barista link, big enough to scan across a kitchen.
   - A **"Send to barista" button** — uses the Web Share API on mobile (share sheet →
     text/AirDrop); falls back to copy-to-clipboard with a "Link copied!" toast on
     desktop.
   - The existing "Place New Order" button.

QR generation uses the tiny MIT-licensed [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator)
library, **vendored into the repo** (`qrcode.min.js`, ~15 KB) rather than loaded from a
CDN, so the pages keep working offline / if a CDN blips.

The barista link is built from the page's own origin, so it works on GitHub Pages and
locally without configuration: `new URL('barista.html#o=' + payload, location.href)`.

## Page 2: `barista.html` (barista)

Same visual language as the order page (coffee-gradient background, white rounded
cards). Sections top to bottom:

### Ingest
On every page load, check `location.hash`:
- If `#o=<payload>` is present and valid → decode, dedupe by `id`, add to the queue as
  **Pending**, clear the hash (`history.replaceState`), and flash a "New order from
  Melissa!" banner.
- If the payload is malformed → show a dismissible "Couldn't read that order link"
  error; never crash.

### Queue (the main event)
Orders grouped by status, oldest first within a group:

- **Pending** — card shows name, drink line ("Medium Starbucks Colombian, Hot, with
  Milk"), how long ago it was placed (live-updating "3 min ago"), tip amount, and the
  pre-submitted star ratings. One button: **Start** → In Progress.
- **In Progress** — same card, button becomes **Done** → moves to history. Also an
  **↩ Undo** back to Pending for mis-taps.
- Pending count shown in the page title (`(2) Barista — Elemental Brew`) so the
  tab itself is a notification.

Every card also gets a small ✕ to cancel/remove an order (with a confirm).

### History & stats
Collapsible "Completed today" list plus an all-time stats strip:

- **Total tips earned** (the headline number, obviously)
- **Average barista rating** and **average coffee rating**
- **Drinks made** count
- A "Clear history" button (confirm required).

### Storage
Everything lives in `localStorage` under one key, e.g. `elemental-brew-barista-v1`:

```json
{ "orders": [ { ...order, "status": "pending|in-progress|done", "doneAt": 0 } ] }
```

`v1` in the key allows painless future schema changes. Cap stored orders at ~500,
pruning oldest done orders first — nobody's localStorage should die for coffee.

## Constraints & accepted trade-offs

- **Manual handoff per order** — cross-device delivery requires the customer to share
  each link (chosen over Firebase). If this gets tedious, swapping the transport layer
  for Firebase later only touches the "success screen" and "ingest" pieces; the payload
  format and queue UI are transport-agnostic.
- **Queue lives on one device** — the barista's queue is in that browser's
  localStorage. Opening `barista.html` elsewhere starts an empty queue. One barista
  station is the model.
- **Ratings precede coffee** — by design and household tradition.
- **No auth** — anyone with the barista URL can open it; the stakes are coffee.

## File plan

```
elemental-brew/
├── index.html      (modified: name field, QR/share success screen)
├── barista.html    (new: ingest, queue, history/stats)
├── qrcode.min.js   (new: vendored QR library)
└── SPEC.md         (this file)
```

No build step, no framework — same vanilla HTML/CSS/JS as today. Shared styles are
duplicated between the two pages rather than extracted, keeping each page
self-contained.

## Test checklist (manual)

- [ ] Order placed on iPhone → QR scanned by second phone → order appears Pending
- [ ] Same link opened twice → still only one order (dedupe by id)
- [ ] Share button: share sheet on mobile, clipboard + toast on desktop
- [ ] Water order skips temperature/milk and encodes correctly
- [ ] Barista page reload mid-queue → statuses intact
- [ ] Malformed `#o=` payload → friendly error, page still usable
- [ ] Tips total and rating averages match the orders completed
