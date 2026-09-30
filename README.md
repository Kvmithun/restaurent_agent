# Restaurant Multi-Agent Ordering Platform

A modular restaurant ordering platform. The backend owns all business truth; the LLM interprets and communicates, MongoDB stores permanent records, Redis stores active workflow state, LangGraph coordinates the AI ordering flow, and React presents the user experience.

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

The backend health route is `GET /api/health`. Business decisions remain deterministic and do not rely on generated model text.

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/state-management.md](docs/state-management.md).
