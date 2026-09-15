# Handoff business model

> Written 2026-09-14. Payments are not connected yet. David will say when to wire Stripe.

## Principle

Listing and browsing stay free forever. Handoff never takes a cut of rent. Revenue comes from listers who want more attention on a specific listing for a short window, which is exactly when a sublease is urgent.

## The product: Boost

One product, one price.

| | |
| --- | --- |
| Name | Boost |
| Price | $9 for 7 days |
| Who buys | The lister, on an active listing they own |
| What it does | Pinned to the top of the list for any map area it appears in, filled blue pin on the map, "Boosted" tag on the card and the detail page, and a small stats line for the lister (views and requests since the boost started) |
| Limits | One active boost per listing, boosts can be renewed once the current one ends, no stacking |

### Why $9 is fair

- A typical room near USC lists around $1,200 a month, so one empty week costs the lister about $280. A boost costs less than one empty day.
- Facebook Marketplace boosts run about $5 to $15 for a few days. Roomster charges about $6 a week as a subscription. Craigslist charges $5 to $25 per housing post in some cities. Handoff sits in the same range with a clearer promise.
- Round, memorable, and low enough that a student pays without thinking twice. A boost that helps a lister avoid even a few empty days pays for itself many times over.

### Launch phase, before Stripe

Everything about Boost is built and visible. The "Pay $9" button is grayed out with "Payments open soon". A free launch boost is offered instead, one per listing, so listers use the feature now and the ranking, tags, and stats get real use. When Stripe connects, the free launch boost is switched off and the pay button lights up. Free boosts are recorded with `price_cents = 0` and `kind = launch` so they can be counted later.

### When Stripe connects

Stripe Checkout with a one time price. Webhook marks the boost paid and starts the 7 days. Refund policy: full refund within 24 hours if the listing has had no views, otherwise no refunds, stated on the terms page.

## AI listing help

Smart import and the chat helper are free, for the same reason listing is free. The point is to remove the blank form, which is the moment most listers give up, so more rooms reach the map. They are a cost line, not a product.

The cost is small enough to ignore at this size. One real text import measured 1,010 input and 438 output tokens, which at the published `gpt-5.6-luna` rate ($0.20 per million input, $1.20 per million output) is well under a cent. Screenshots cost more than text and are capped at four per import, resized before sending. A hundred imports a week stays in the low single dollars a month. Usage is recorded per call in `ai_usage` and reported with `node server/operator.js ai-usage`, so if it ever stops being a rounding error we will see it before the bill does. The per account limits (20 imports and 120 chat turns an hour, verified students only) put a ceiling on abuse.

## Later options, not built

- Boost bundle, $19 for 21 days, for full lease takeovers that take longer.
- Featured on the campus digest email, sold with the boost once the digest exists.
- Taker side alerts for a chosen budget and area, free at first, later a small monthly fee if demand justifies it.
- Campus partnerships (housing offices, student unions) that sponsor free boosts for their students.

## What we will not do

- No commission on rent.
- No pay to message. Requests stay free so takers are never gated.
- No selling of student data.
