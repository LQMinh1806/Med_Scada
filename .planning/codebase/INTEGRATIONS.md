# Integrations
**Date:** 2026-04-24

## Databases
- **PostgreSQL**: Accessed via Prisma ORM.

## External Systems & APIs
- **Kepware/PLC (OPC UA)**: Connected via `node-opcua` to control SCADA system.
- **Socket.io**: Real-time bidirectional communication between frontend and backend.
- **ESP32 Fingerprint System**: ESP32 interacts via `ESP32_API_KEY` for biometric auth.

## Authentication
- **JWT (jsonwebtoken)**: Used for session tokens (`scada_access_token` cookie).
- **CSRF**: Custom CSRF token implementation via cookies and headers.
- **Bcryptjs**: Password hashing.
