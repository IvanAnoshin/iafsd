# UI native dialog cleanup

This pass removes native browser `prompt`, `confirm`, and `alert` usage from the user-facing feed/profile/chat flows.

## Replaced with internal minimal dialog

- Feed comment edit/delete/report
- Feed post report
- Own profile comment edit/delete/report
- Own profile post report
- Public profile comment edit/delete/report
- Public profile post report
- Chat single-message report flow
- Chat selected-message delete confirmation

## Component

Added `components/MinimalActionDialog.jsx`:

- `useMinimalActionDialog()`
- `MinimalActionDialog`

The component is intentionally small and generic. It supports only two modes:

- text input / textarea
- confirmation

## Notes

This is a KISS cleanup pass. It does not redesign the full reporting UX and does not change backend behavior.
