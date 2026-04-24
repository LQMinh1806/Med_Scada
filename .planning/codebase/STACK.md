# Tech Stack
**Date:** 2026-04-24

## Languages
- JavaScript (Node.js/ESModules)
- React (JSX/JS)
- CSS/HTML

## Runtime & Frameworks
- Node.js (Backend)
- Express.js (API Server)
- React 19 (Frontend)
- Vite (Build Tool & Dev Server)

## Dependencies (Core)
- **Database:** Prisma ORM (`@prisma/client`), PostgreSQL
- **UI:** Material UI (`@mui/material`), Emotion, React Leaflet
- **Networking:** Socket.io, node-opcua
- **Auth:** bcryptjs, jsonwebtoken

## Configuration
- `.env` for environment variables
- `vite.config.js` with proxy to `http://127.0.0.1:3000`
- `eslint.config.js` for linting
- `package.json` with npm scripts for full-stack dev (`dev:all`)
