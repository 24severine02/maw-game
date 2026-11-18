# Maw

Online multiplayer card game for 2–8 players. Rules: [SPEC.md](SPEC.md).

## Play locally

Requires Node 22+ and pnpm.

```
pnpm install
pnpm dev
```

Open http://localhost:3000, enter a nickname, create a room, add bots or share the link (other devices on your network can use `http://<your-ip>:3000/room/<CODE>`), and start.

## Develop

```
pnpm test        # all tests
pnpm typecheck
pnpm build
```

See [CLAUDE.md](CLAUDE.md) for the project layout and conventions.
