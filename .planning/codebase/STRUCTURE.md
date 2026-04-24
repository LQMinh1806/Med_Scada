# Directory Structure
**Date:** 2026-04-24

## Layout
- `server.js`: Main backend entry point containing Express routes and Socket.io setup.
- `opcua-service.js`: Contains logic for OPC UA connections and Kepware interaction.
- `src/`: Frontend React source code.
- `prisma/`: Prisma schema and migrations.
- `scripts/`: Utility scripts (e.g., for starting PostgreSQL).
- `public/`: Static assets.
- `dist/`: Compiled frontend output.

## Key Locations
- **Backend Entry**: `server.js`
- **Frontend Entry**: `src/main.jsx` (implied by standard Vite react setup)
- **Database Schema**: `prisma/schema.prisma`
- **Config**: `vite.config.js`, `package.json`
