# Coffee Run

Coffee Run is a small interactive caffeine spiral simulator.

The homepage renders a Matter.js-powered figure and caffeine blocks, then drives visual intensity as caffeine level rises.

## Stack

- Next.js (App Router)
- React 19
- tRPC 11 + TanStack Query
- Matter.js
- Biome + TypeScript

## Scripts

- `pnpm dev`: start local dev server
- `pnpm check`: run Biome checks
- `pnpm typecheck`: run TypeScript checks
- `pnpm build`: production build
- `pnpm preview`: build and run production server

## Key Files

- `src/app/page.tsx`: app entry route
- `src/app/_components/CoffeeGame.tsx`: main gameplay and rendering logic
- `src/app/api/trpc/[trpc]/route.ts`: tRPC HTTP handler
- `src/server/api/trpc.ts`: tRPC context/router/procedure setup
- `src/server/api/routers/post.ts`: sample post router

## Notes

- This project intentionally keeps API/data scaffolding light.
- The post router is an in-memory example and resets on server restart.
