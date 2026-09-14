# Handoff UI brief for the September 2026 visual pass

Read this before touching any page. It is the contract every page must follow so the app reads as one product.

## What the app is

Handoff is a student to student sublease marketplace. React 19, TypeScript, Vite, React Router 7, Leaflet, lucide-react icons. No Tailwind, no component library. Plain CSS files under `src/styles/`, imported in order by `src/styles/index.css`.

Design reference is https://handofflease.vercel.app (simple Handoff wordmark, brand blue, white surfaces, listing cards, split map layout). The Browse page in this repo is now the finished reference for the new look. Open it at http://127.0.0.1:4741/browse (API on 4742, both are already running as preview servers, do not start new ones on those ports). Study it and match it.

## Files and ownership

| File | Owner | Notes |
| --- | --- | --- |
| `src/styles/motion.css` | shared, read only | transitions.dev motion tokens (`--duration-*`, `--ease-*`, `--dropdown-*`, `--modal-*`, `--toast-*`, and so on) |
| `src/styles/base.css` | shared, read only | design tokens, resets, buttons, chips, pills, fields, modal, toast, header, page containers, skeletons, stagger |
| `src/styles/browse.css` | shared, read only | browse split layout, listing cards (`.listing-card.compact` and `.listing-card.grid`), map chrome, popovers (`.popover`, `.popover-body`, `.popover-list`, `.preset-list .option`, `.segment`) |
| `src/styles/legacy-responsive.css` | do not edit | leftover media queries, will be deleted once every page file is self contained |
| `src/styles/auth.css` + `src/pages/Auth.tsx` | auth agent | |
| `src/styles/detail.css` + `src/pages/ListingDetail.tsx` | detail agent | |
| `src/styles/editor.css` + `src/pages/ListingEditor.tsx` | editor agent | |
| `src/styles/account.css` + `src/pages/Account.tsx` | account agent | Saved, My listings, Requests, Profile |
| `src/components/ui.tsx`, `Layout.tsx`, `ListingCard.tsx`, `Map.tsx`, `Popover.tsx` | shared, read only | if a primitive needs a change, describe it in your report instead of editing |

Your page stylesheet must be fully self contained, including its own responsive rules, because `legacy-responsive.css` is deleted after this pass. Never edit a file you do not own. Never change server code, tests, or API contracts. This is a visual and interaction pass only.

## Tokens to use (from base.css)

Colors `--blue`, `--blue-hover`, `--blue-soft`, `--blue-soft-2`, `--blue-ink`, `--ink`, `--ink-2`, `--muted`, `--muted-2`, `--line`, `--line-2`, `--soft`, `--soft-2`, `--surface`, `--green`, `--green-soft`, `--green-ink`, `--amber-soft`, `--amber-ink`, `--red`, `--red-soft`, `--red-ink`.

Radius `--r-xs` 6, `--r-sm` 8, `--r-md` 12, `--r-lg` 16, `--r-xl` 20, `--r-pill`. Concentric rule, outer radius equals inner radius plus padding.

Depth `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--ring` (1px hairline as box shadow). Prefer `box-shadow: var(--shadow-sm), var(--ring)` over borders on cards. Use `.surface` for a plain white card.

Layout `--header-h` 60, `--control-h` 40, `--input-h` 42, `--page-x`, `--page-max` 1240. `.page-container` (max 1240) and `.page-container.narrow` (720). `.page-heading` with `h1` 26px, `.eyebrow`, `.heading-actions`.

Primitives `.button` with `.primary .secondary .ghost .danger` and sizes `.small .large`, `.icon-button`, `.text-button`, `.chip`, `.pill` with `.blue .green .amber .red`, `.count-pill`, `.field`, `.field-row`, `.stack`, `.check-label`, `.check-grid`, `.error-box`, `.notice`, `.empty-state`, `.skeleton`, `.enter-stagger` (children rise in with a 40ms stagger), `.modal` (already animated), `.toast`.

Typography Geist body, Plus Jakarta Sans for h1 and big headings. Body 14 to 15px, meta 12 to 13px, eyebrows 11px uppercase with 0.12em tracking. `tabular-nums` is global. Headings use `text-wrap: balance`.

## Layout and density rules

- Fill the screen. No hero copy, no oversized headings, no 48px page paddings. Page top padding 28px desktop, 20px mobile. Section gaps 20 to 24px. Card padding 14 to 18px.
- Spacing scale 4, 6, 8, 10, 12, 14, 16, 20, 24, 32. Nothing else.
- Every control at least 36px tall, primary form controls 40 to 42px. Hit areas at least 40x40 (extend with a pseudo element if the visible control is smaller).
- Photos always get an object-fit cover and a hairline outline `box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08)` or the `--ring`.
- Two column desktop layouts collapse to one column at 760px. There is a fixed bottom mobile nav 64px tall, `main` already pads for it.
- Sticky side panels on desktop where the reference does it (listing detail request card, editor step list).

## Motion rules (transitions.dev and make-interfaces-feel-better)

- Reference the motion tokens, never hardcode durations or easings. Hover in 150ms (`--duration-quick`), open 250ms (`--duration-fast`), close 150ms, panel reveal 400ms (`--duration-slow`). Easing `--ease-smooth-out` for movement, `--ease-out` for color.
- `transition` always lists explicit properties. Never `transition: all`.
- Press feedback is `transform: scale(0.96)` on `:active` (already on `.button`, `.icon-button`, `.chip`).
- Enter animations split content into chunks and stagger by 40ms (`.enter-stagger`). Exits are subtler than enters.
- Keep every `@media (prefers-reduced-motion: reduce)` guard, base.css already zeroes durations globally.
- Skill references live at `/Users/david/.claude/skills/transitions-dev/` (32 snippets, read the ones you use, `06-modal.md`, `10-success-check.md`, `12-error-state-shake.md`, `14-skeleton-reveal.md`, `16-tabs-sliding.md`, `21-accordion.md`, `25-checkbox-check.md`) and `/Users/david/.claude/skills/make-interfaces-feel-better/` (principles plus `surfaces.md`, `animations.md`, `typography.md`). Apply them where they fit, do not force them.

## Writing rules for any copy or docs you produce

No em dashes, no en dashes, anywhere. Use a comma, a period, or parentheses. Avoid colons in prose sentences. Concise and direct.

## Demo data

The local database is seeded. Sign in with `demo.owner@usc.edu` and password `Demo password 2026!` (Maya Chen, has drafts, a handed off listing, saved places, and requests in every status). Other accounts use the same password, `demo.jordan@usc.edu`, `demo.priya@usc.edu`, `demo.marcus@usc.edu`, `demo.sofia@ucla.edu`, `demo.ethan@ucla.edu`, `demo.alina@lmu.edu`.

## Verification

Use the Browser pane tools (`mcp__Claude_Browser__*`). Other agents share the same Browser pane, so first call `tabs_create` to get your own tab, load http://127.0.0.1:4741 in it, and pass that `tabId` on every call. Never act on a tab you did not create and never close other tabs. Emulate 1440x900 for desktop and the `mobile` preset for phones, and check both. Read console errors. Run `npx tsc -b` from the app root before reporting. Do not run `npm run build` and do not run the seed script.

Report format, a table of Before and After changes grouped by principle, plus any shared primitive change you want made by the integrator.
