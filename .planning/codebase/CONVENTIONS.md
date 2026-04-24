# Coding Conventions
**Date:** 2026-04-24

## Code Style
- **JavaScript**: ES Modules (`"type": "module"` in `package.json`).
- **Formatting/Linting**: ESLint 9 (`eslint.config.js`).

## Naming
- CamelCase for variables and functions.
- PascalCase for React components and Database Models.
- UPPER_SNAKE_CASE for constants (`DB_ROLE`, `ESP32_API_KEY`).

## Error Handling
- Use `try/catch` blocks in async route handlers and Socket.io events.
- Centralized error logging using `console.error`.
- Meaningful HTTP status codes (400, 401, 403, 409, 500) are returned in REST API endpoints.
