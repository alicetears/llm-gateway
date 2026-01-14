# LLM Gateway API

A production-grade Multi-Provider LLM Gateway API with key-aware model routing, built with Node.js, TypeScript, Fastify, PostgreSQL, and Redis.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, OpenRouter, Gemini, Mistral, Groq, Together AI, Fireworks AI, DeepSeek
- **Key-Aware Model Routing**: Each API key can be restricted to specific models with a default model
- **Priority-Based Selection**: Route requests through keys based on configurable priority levels
- **Quota Management**: Daily request limits per key with automatic reset
- **Two Selection Strategies**:
  - `exhaust-first`: Use keys until quota is exhausted before moving to next
  - `round-robin`: Distribute load evenly across keys
- **Async Processing**: Optional queue-based processing with BullMQ
- **Comprehensive Observability**: Request logging, usage tracking, and optional response headers
- **Automatic Fallback**: Retry with different keys on failure

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Request                               │
│                     POST /api/chat                               │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Request Router                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Validate  │→ │ Key Manager │→ │ Provider Selection      │  │
│  │   Request   │  │  (Routing)  │  │ (Priority + Strategy)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Provider Adapters                              │
│  ┌────────┐ ┌───────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│  │ OpenAI │ │ Anthropic │ │ Gemini │ │  Groq  │ │  ...   │     │
│  └────────┘ └───────────┘ └────────┘ └────────┘ └────────┘     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Unified Response                               │
│         + Usage Tracking + Observability Headers                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd llm-gateway

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your database and Redis URLs
```

### Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Or push schema directly (development)
npm run db:push
```

### Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start

# Start queue worker (separate process for async requests)
npm run worker
```

## API Reference

### Chat Completion

**POST** `/api/chat`

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "model": "gpt-4o",
  "provider": "auto",
  "allowedProviders": ["openai", "anthropic"],
  "allowedPriorities": [1, 2],
  "temperature": 0.7,
  "maxTokens": 1000,
  "async": false
}
```

**Request Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | array | Yes | Chat messages |
| `model` | string | No | Model to use (uses key's default if not specified) |
| `provider` | string | No | Provider selection: `auto`, `openai`, `anthropic`, etc. |
| `allowedProviders` | string[] | No | Restrict to specific providers |
| `allowedPriorities` | number[] | No | Restrict to specific priority levels |
| `temperature` | number | No | Sampling temperature (0-2) |
| `maxTokens` | number | No | Maximum tokens in response |
| `async` | boolean | No | If true, queue the request and return immediately |

**Response:**

```json
{
  "id": "chatcmpl-abc123",
  "provider": "openai",
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finishReason": "stop"
    }
  ],
  "usage": {
    "promptTokens": 20,
    "completionTokens": 10,
    "totalTokens": 30
  },
  "created": 1699000000000
}
```

**Response Headers (when enabled):**

- `X-LLM-Provider`: Provider used
- `X-LLM-Model`: Model used
- `X-LLM-Key-ID`: API key ID used
- `X-LLM-Latency-Ms`: Request latency

### Key Management

**GET** `/api/keys` - List all API keys

**POST** `/api/keys` - Create a new API key

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "name": "Production OpenAI Key",
  "priority": 1,
  "enabled": true,
  "allowedModels": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  "defaultModel": "gpt-4o-mini",
  "dailyLimit": 1000
}
```

**PUT** `/api/keys/:id` - Update a key

**DELETE** `/api/keys/:id` - Delete a key

**GET** `/api/keys/:id/usage` - Get usage history

**POST** `/api/keys/:id/reset` - Reset daily usage

### Health Checks

- **GET** `/health` - Basic health check
- **GET** `/health/ready` - Readiness check (includes dependencies)
- **GET** `/health/live` - Liveness check

### Queue Statistics

**GET** `/api/queue/stats`

```json
{
  "waiting": 5,
  "active": 2,
  "completed": 1000,
  "failed": 3,
  "delayed": 0
}
```

## Key-Aware Model Routing

### How It Works

1. **Request arrives** with optional `model` and `provider` parameters
2. **Filter keys** by:
   - `enabled` status
   - `allowedProviders` (if specified in request)
   - `allowedPriorities` (if specified in request)
   - Provider match (if not `auto`)
3. **For each priority group** (ascending order):
   - Filter keys with remaining quota
   - Filter keys whose `allowed_models` include the requested model
   - Select key using configured strategy
4. **Resolve model**:
   - Use `request.model` if provided
   - Otherwise use `key.default_model`
5. **Execute request** with selected key
6. **Update usage** and log

### Model Matching

Keys can specify allowed models using:

- **Exact match**: `"gpt-4o"` matches only `gpt-4o`
- **Wildcard**: `"gpt-4*"` matches `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
- **All models**: `"*"` or empty array allows all models

### Example Key Configurations

```json
// Production key for expensive models with low limit
{
  "provider": "openai",
  "priority": 1,
  "allowedModels": ["gpt-4o", "o1-preview"],
  "defaultModel": "gpt-4o",
  "dailyLimit": 100
}

// High-volume key for cheaper models
{
  "provider": "openai", 
  "priority": 2,
  "allowedModels": ["gpt-4o-mini", "gpt-3.5-turbo"],
  "defaultModel": "gpt-4o-mini",
  "dailyLimit": 10000
}

// Fallback to OpenRouter for any model
{
  "provider": "openrouter",
  "priority": 3,
  "allowedModels": ["*"],
  "defaultModel": "anthropic/claude-3.5-sonnet",
  "dailyLimit": null
}
```

## Provider Adapters

Each provider adapter:

1. **Validates model compatibility** - Checks if model is supported
2. **Maps model names** - Translates aliases (e.g., `claude-3.5-sonnet` → `claude-3-5-sonnet-20241022`)
3. **Returns unified response** - Consistent format across providers

### Supported Providers

| Provider | API Type | Base URL |
|----------|----------|----------|
| OpenAI | OpenAI-compatible | https://api.openai.com/v1 |
| Anthropic | Anthropic Messages | https://api.anthropic.com |
| OpenRouter | OpenAI-compatible | https://openrouter.ai/api/v1 |
| Google Gemini | Gemini API | https://generativelanguage.googleapis.com |
| Mistral | OpenAI-compatible | https://api.mistral.ai/v1 |
| Groq | OpenAI-compatible | https://api.groq.com/openai/v1 |
| Together AI | OpenAI-compatible | https://api.together.xyz/v1 |
| Fireworks AI | OpenAI-compatible | https://api.fireworks.ai/inference/v1 |
| DeepSeek | OpenAI-compatible | https://api.deepseek.com/v1 |

## Configuration

### Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/llm_gateway

# Redis
REDIS_URL=redis://localhost:6379

# Key Selection Strategy
KEY_SELECTION_STRATEGY=exhaust-first  # or round-robin

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Retry Configuration
MAX_RETRIES=3
RETRY_DELAY_MS=1000

# Queue
QUEUE_CONCURRENCY=10

# Observability
ENABLE_LLM_HEADERS=true
LOG_LEVEL=info
```

## Database Schema

```sql
CREATE TABLE llm_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        VARCHAR NOT NULL,
  api_key         VARCHAR NOT NULL,
  name            VARCHAR,
  priority        INT DEFAULT 1,
  enabled         BOOLEAN DEFAULT true,
  allowed_models  TEXT[],
  default_model   VARCHAR NOT NULL,
  daily_limit     INT,
  used_today      INT DEFAULT 0,
  reset_date      TIMESTAMP DEFAULT NOW(),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  last_used_at    TIMESTAMP
);

CREATE TABLE usage_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id            UUID REFERENCES llm_api_keys(id) ON DELETE CASCADE,
  provider          VARCHAR NOT NULL,
  model             VARCHAR NOT NULL,
  requested_model   VARCHAR,
  prompt_tokens     INT,
  completion_tokens INT,
  total_tokens      INT,
  latency_ms        INT,
  success           BOOLEAN DEFAULT true,
  error_message     VARCHAR,
  request_id        VARCHAR,
  created_at        TIMESTAMP DEFAULT NOW()
);
```

## Queue Worker

For high-throughput scenarios, requests can be processed asynchronously:

```bash
# Start the worker
npm run worker
```

**Async Request Flow:**

1. Client sends request with `async: true`
2. Server returns `202 Accepted` with `requestId`
3. Worker processes the request
4. Client polls `GET /api/chat/:requestId` for result

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "NO_ELIGIBLE_KEY",
    "message": "No eligible API key found for model: gpt-4o",
    "details": {
      "model": "gpt-4o",
      "provider": "openai"
    }
  },
  "requestId": "req_abc123"
}
```

**Error Codes:**

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `MODEL_NOT_SUPPORTED` | 400 | Model not supported by provider |
| `NO_ELIGIBLE_KEY` | 429 | No key available (quota/model mismatch) |
| `RATE_LIMIT_EXCEEDED` | 429 | Gateway rate limit exceeded |
| `PROVIDER_ERROR` | 500 | Provider API error |
| `INTERNAL_ERROR` | 500 | Unexpected error |

## Production Deployment

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY prisma ./prisma
RUN npx prisma generate
CMD ["node", "dist/index.js"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-gateway
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: llm-gateway:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: llm-gateway-secrets
                  key: database-url
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3000
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-gateway-worker
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: worker
          image: llm-gateway:latest
          command: ["node", "dist/queue/worker.js"]
```

## Development

```bash
# Run in development mode
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Open Prisma Studio
npm run db:studio
```

## License

MIT
