# Architecture
**Date:** 2026-04-24

## System Pattern
The application follows a Client-Server architecture with a real-time communication layer.
- **Frontend**: Single Page Application (SPA) using React.
- **Backend**: RESTful API + Socket.io Server + OPC UA Client.

## Data Flow
1. **Frontend to Backend (HTTP)**: REST API calls for auth, data retrieval, and user management.
2. **Frontend to Backend (WebSocket)**: Socket.io for real-time PLC commands (e.g., `plc:callCabin`, `plc:eStop`).
3. **Backend to PLC (OPC UA)**: Node.js server acts as an OPC UA client to Kepware/PLC for SCADA control.
4. **Backend to Frontend (SSE/WebSocket)**: Real-time sync events (`sync-required`) and OPC UA state updates are pushed to clients.

## Key Abstractions
- **OPC UA Service**: Encapsulates PLC interaction (`callCabin`, `setEStop`) in `server.js` and `opcua-service.js`.
- **Database Access**: Prisma ORM is used across routes for accessing `User`, `Station`, `Specimen`, etc.
