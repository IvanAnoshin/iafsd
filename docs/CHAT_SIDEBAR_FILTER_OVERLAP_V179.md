# v179 — Chat sidebar filter overlap fix

Fixed clipping/overlap in the chat sidebar controls area on small mobile screens.

## Changed

- Increased the visible max-height of `.chatW-scrollControls` when controls are shown.
- Added safe bottom padding between Moments, search filter chips, sidebar filters, and chat list.
- Ensured filter chips stay in their own scrollable rows and do not visually collide with the list below.
- Added compact mobile-height overrides so the fix works on short screens.

## Not changed

- No chat API changes.
- No messenger business logic changes.
- No Moments publishing/viewer logic changes.
