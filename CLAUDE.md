# Maw

Online multiplayer browser card game (2–8 players, with voice chat). The rules are in `SPEC.md`, extracted from `maw-spec.pdf`.

## Structure

pnpm monorepo, TypeScript strict everywhere, Vitest for tests.

```
packages/engine/   @maw/engine: the pure rules engine (Phase 1, done)
  src/cards.ts       cards, deck building, deck count, scoring table
  src/rng.ts         seedable RNG (mulberry32, state is one uint32) + shuffle
  src/types.ts       GameState, RoundState, Action, errors
  src/setup.ts       createGame, dealRound, starting-card effects
  src/rules.ts       playability, Jack resolution, play-again, seating
  src/reducer.ts     reduce(state, action) → { ok, state } | { ok: false, error }
  src/view.ts        getPlayerView(state, playerId): hides other hands, the draw pile and the RNG
  src/legal.ts       getLegalActions(view, now): computed from the view only
  src/bot.ts         chooseBotAction(view, now, rand, options): random legal bot
  src/invariants.ts  checkInvariants(state): structural checks used by the fuzz test
  src/clone.ts       copy-on-write state clone used by the reducer
  test/              one file per spec area + fuzz.test.ts + purity.test.ts
packages/protocol/ @maw/protocol: Socket.io event + payload types (types only, no runtime)
apps/server/       @maw/server: authoritative Socket.io game server (Phase 2)
  src/room.ts        Room: lobby, GameState, timers (Mamaw TICK, next round, reconnect grace), bots
  src/server.ts      createMawServer(): sockets ↔ rooms, seat tokens, abandoned-room cleanup, /health
  src/describe.ts    public game-log lines (never names a drawn card)
  src/main.ts        entry point (PORT, HOST, WEB_ORIGIN env)
apps/web/          @maw/web: Next.js 16 App Router client (Phase 2)
  app/page.tsx       home: nickname, create room, join by code
  app/room/[id]/     room page → components/RoomClient (socket, join/reconnect) → Lobby | Table
  lib/client.ts      socket factory, localStorage session/name, card helpers, useNow
```

Phases: 1 engine ✔ · 2 server + playable web ✔ · 3 voice (WebRTC mesh + STUN/TURN) · 4 visual polish · 5 Docker/Azure.

## Commands

Run from the repo root:

```
pnpm install
pnpm dev           # engine watch + server :3001 + web :3000 → open http://localhost:3000
pnpm test          # all tests (engine: ~7s, includes the 1,000-game fuzz)
pnpm coverage      # tests + coverage; the engine enforces 100% thresholds
pnpm typecheck
pnpm build
```

`pnpm test`/`typecheck` build the engine first: server and web import `@maw/engine` from its `dist/`.
The web app uses TypeScript 6 (Next.js needs the classic TS JS API); everything else uses TypeScript 7.

For a single file: `pnpm --filter @maw/engine exec vitest run test/maw.test.ts`

## Engine rules (must hold)

- **Pure.** No I/O, no `Date`/timers, no `Math.random`, no `console`, no async, no npm or `node:` imports in `packages/engine/src`. `test/purity.test.ts` enforces this.
- **Deterministic.** The same seed and the same actions give an identical state. All randomness goes through `rng.ts`, and its state lives in `GameState.rng`.
- **Time is input.** Every action carries `now` (ms) from the server. The 5s Mamaw window closes when the server sends `{ type: 'TICK', now }`.
- **Never mutate** the input state. The reducer clones with `cloneState`, and `Card` objects are treated as immutable and shared. The deep fuzz games check this.
- **The server is authoritative.** Clients only ever receive `getPlayerView(state, id)`. Never send the full state.
- New rules need a test in the matching file, and the fuzz test must keep passing. Keep coverage at 100%.
- Rule decisions not in the spec are listed below. Update this list when you add one.

## Server / client rules

- Clients only send `PlayerAction`s (no `playerId`, no `now`, never TICK/NEXT_ROUND); the server fills those in. Never trust anything else from the client.
- Each member gets `room.view(id)` (engine `getPlayerView` + room info) after every change. Never broadcast one view to a whole room.
- The web client computes highlights/buttons with `getLegalActions(view.game, serverNow)`; the server re-validates everything.
- Seats are reclaimed with a per-room token stored in localStorage (`maw:session:<ROOM>`).
- State is in memory only (no database): restarting the server ends all games.

## Server decisions (not in the spec)

- Bots: host adds them in the lobby. They wait 0.9–1.8s per move and 2–3.2s before a call-out (so a human can press late first). They forget Maw/Mamaw 10% of the time, then press late 50% of the time, and call out 60% of the time.
- Disconnect: seat kept 45s; then in the lobby the seat is removed, in a game a bot plays it (never calls out on their behalf) until they return. Leave = immediate.
- Host = first human; passes to a connected human if the host leaves or goes on autopilot. Host can remove players in the lobby and return everyone to the lobby after the game.
- Next round is dealt automatically 8s after a round ends. No turn timer: an idle connected player stalls the game.
- No joining mid-game (except reconnecting). Rooms with no connected human are deleted after 10 minutes.
- Maw/Mamaw buttons are always visible (pressing is part of the game): before playing they arm and apply to your next card if valid; once owed (late press, or no-win-on-a-9) they are sent directly.
- Every Maw, Mamaw and call-out is shown big on every screen: `RoomView.announcement` (latest one, with a server timestamp so reconnects don't replay it).

## Rule decisions not in the spec

- In the final, Q and 8 as the last card still win. Only a 9, or a Jack acting as a 9, blocks the win.
- Round 1: seat 0 starts. Later rounds: the previous round's winner starts.
- Voluntary draw is allowed even with a playable card. After any single draw, only the drawn card may be played; otherwise PASS.
- Maw and Mamaw are flags on PLAY (`say: 'maw' | 'mamaw'`). They can also be pressed late: `MAW` at any time while you owe it (until called out or the next card is played), `MAMAW` during your own 5s window (the win then stands at once). `MAW` is also how the no-win-on-a-9 case presses Maw after drawing from 0 to 1 card; that debt only becomes callable once the player passes.
- Starting card: 7 means the first player faces +2. 8 skips the first player. Q reverses direction, but the first player still starts. 9 has no effect. Jack means the first player chooses a suit (`CHOOSE_SUIT`). In the final, a starting Q or 8 has no effect.
- After drawing a 7-stack penalty, the turn continues and a single §2 draw is still allowed.
- If both piles are exhausted, the remaining draws are forfeited. Reshuffling happens when a draw needs a card.
- A call-out is rejected (no penalty) if nobody forgot. Only players seated in the round can call out. The forgetter's call-out debt survives draws and passes, and ends at the next card played.
- A forgotten Mamaw still applies the card's effect. During the window only `CALL_OUT` and `TICK` are accepted.
- Mamaw on a last-card 9 is optional and has no effect either way.
- Round end shows the points per player, but hands stay hidden in the view.
