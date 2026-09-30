# Restaurant Multi-Agent Ordering Platform

A modular restaurant ordering platform. The backend owns all business truth; the LLM interprets and communicates, MongoDB stores permanent records, Redis stores active workflow state, LangGraph coordinates the AI ordering flow, and React presents the user experience.

Includes customer, restaurant, delivery partner, and operator workflows; AI ordering with availability checks; PDF/image/CSV/text menu extraction into restaurant-reviewed drafts; and private verification document uploads.

## Project layout

- `backend/` Express API, domain services, persistence adapters, and AI workflow.
- `frontend/` React application.
- `docs/` architecture, state, API, and implementation notes.

## Prerequisites

Node.js 20+, npm, MongoDB, Redis, and a Groq API key for AI features.

## Setup

1. Copy `.env.example` to `.env` and provide local service credentials. A local development `.env` is already present in this checkout; add your Groq key to it.
2. Run `npm install` from the repository root.
3. Run `./dev.sh` to start both workspaces. You can also use `npm run dev` when Node.js is correctly installed for your processor architecture.

The backend health route is `GET /api/health`. Business decisions remain deterministic and do not rely on generated model text. Set `ADMIN_REVIEW_TOKEN` and use `/admin/review` to inspect documents and approve/reject restaurant and delivery registrations. Set `UPLOAD_DIRECTORY` to a private local path; production multi-instance deployments need shared private object storage.

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/state-management.md](docs/state-management.md).
