# Messenger pre-launch smoke checklist

## Core chat
- Open chat list, archived chats, and requests
- Send a text message and verify preview/unread updates
- Edit and delete a message
- Retry a failed media message

## Media
- Upload image, video, and file attachments
- Record and send a voice message
- Open video note flow and verify fallback if camera is unavailable

## Calls
- Start an audio call and end it cleanly
- Verify video call fallback to audio when camera is missing
- Confirm call status updates in another tab

## Realtime
- Presence refresh after reconnect
- Typing indicator appears and clears
- Unread counters sync across tabs

## UX and accessibility
- No debug panels in normal mode
- Keyboard focus ring is visible on chat controls
- Error notices are compact and disappear automatically
- Reduced motion mode removes chat transitions

## Safety and production checks
- Rate limits enabled in production env
- Permissions-Policy allows microphone/camera only for self
- Upload limits are configured
- Hidden debug mode still works through `?debug=1`


## E2EE and device trust
- Same trusted device restores protected chats automatically after re-login
- New device can request transfer from an older trusted device
- Recovery file restores protected chats when no trusted device is available
- Protected chat search clearly warns that encrypted text is excluded

## Production config
- `npm run check:env` passes with upload limits and anti-spam windows set correctly
- `npm run verify:launch` confirms routes, models, checklist and security headers
- Permissions-Policy stays locked to `camera=(self), microphone=(self)`
- API responses keep `Cache-Control: no-store`
