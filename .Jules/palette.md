## 2025-05-22 - [Personalized Greetings & Error Recovery]
**Learning:** In Telegram bots, using `message.From.FirstName` provides a much warmer UX than using `Username` (which can be null or a cryptic handle). Always provide a friendly fallback like "друг" (friend) to avoid empty greetings.
**Action:** Always check for `FirstName` first and use a robust fallback for all automated greetings.

**Learning:** Multi-step processes (like entering a 6-digit code) benefit greatly from having an inline "Cancel" button in every instruction/error message. This prevents users from feeling trapped if they lose the original message or want to abort.
**Action:** Include a "Cancel" button in all state-dependent instruction messages.
