# Architecture

```mermaid
flowchart TD
  UI[React] --> API[Express API]
  API --> REST[Normal APIs]
  API --> AI[AI API]
  REST --> DB[(MongoDB: persistent truth)]
  AI --> GRAPH[LangGraph orchestration]
  GRAPH --> LLM[Groq: language only]
  GRAPH --> DB
  GRAPH --> REDIS[(Redis: active session state)]
  DB --> U[Users]
  DB --> R[Restaurants and menus]
  DB --> D[Delivery partners]
  DB --> O[Orders and attempts]
```

React communicates through Express. Normal APIs and AI workflow nodes use domain services and repositories; route handlers do not own business rules. MongoDB is the permanent source of truth. Redis contains expiring conversation and graph state. The model can interpret and phrase requests but cannot write data or decide availability, price, assignment, or lifecycle status.

The first implementation milestone establishes this boundary and typed session contract. Domain models, authentication, ordering, restaurant operations, delivery, and AI graph nodes are added as subsequent milestones. See [api.md](api.md), [database.md](database.md), [ai-agent.md](ai-agent.md), and [deployment.md](deployment.md) for the planned contracts and current gaps.
