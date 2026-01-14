# LLM Gateway

A self-hosted, open-source Multi-Provider LLM Gateway with key-aware model routing.

> **This is a self-hosted solution.** The author does not operate any hosted service. You deploy and operate your own instance.

---

## Deploy Your Own Instance

The fastest way to get started is to deploy your own instance using Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Falicetears%2Fllm-gateway&env=DATABASE_URL,JWT_SECRET&envDescription=DATABASE_URL%3A%20PostgreSQL%20connection%20string.%20JWT_SECRET%3A%20Random%20secret%20for%20auth%20tokens.&envLink=https%3A%2F%2Fgithub.com%2Falicetears%2Fllm-gateway%23environment-variables&project-name=my-llm-gateway&repository-name=my-llm-gateway)

### What happens when you click "Deploy"

1. You will be prompted to create a copy of this repository in your own GitHub account
2. Vercel will deploy the application to **your own Vercel account**
3. You will need to configure environment variables (database, secrets)
4. The deployed instance is entirely under your control

> ⚠️ **Important:** The author does not operate, monitor, or control any deployed instances. Each deployment is independent and managed by the person who deploys it.

---

## Self-Hosting Responsibility

When you deploy this software, **you are the operator**. You are solely responsible for:

| Responsibility | Description |
|----------------|-------------|
| **API Keys** | Safeguarding any LLM provider API keys you configure |
| **Security** | Securing your deployment, setting strong secrets, and managing access |
| **Costs** | Any charges incurred from LLM providers (OpenAI, Anthropic, etc.) |
| **Compliance** | Adhering to the terms of service of each LLM provider you use |
| **Data** | Any data processed through your instance |
| **Availability** | Uptime and maintenance of your deployment |

### Security Warning

> ⚠️ **Do NOT use real API keys unless you understand and trust the code.**
>
> Before adding production API keys:
> 1. Review the source code
> 2. Ensure your `JWT_SECRET` is set to a strong, random value
> 3. Understand that API keys are stored in your database
> 4. Restrict access to your deployment appropriately

---

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, OpenRouter, Gemini, Mistral, Groq, Together AI, Fireworks AI, DeepSeek
- **Key-Aware Model Routing**: Each API key can be restricted to specific models with a default model
- **Priority-Based Selection**: Route requests through keys based on configurable priority levels
- **Quota Management**: Daily request limits per key with automatic reset
- **User Isolation**: Each user's API tokens only access their own keys
- **Admin Controls**: First user becomes admin; registration can be enabled/disabled
- **Two Selection Strategies**:
  - `exhaust-first`: Use keys until quota is exhausted before moving to next
  - `round-robin`: Distribute load evenly across keys

---

## Quick Start (Vercel)

### 1. Deploy

Click the "Deploy with Vercel" button above.

### 2. Configure Database

You need a PostgreSQL database. Options:

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| [Vercel Postgres](https://vercel.com/storage/postgres) | 256 MB | Easiest - integrates directly |
| [Neon](https://neon.tech) | 512 MB | Recommended |
| [Supabase](https://supabase.com) | 500 MB | Full Postgres |

Set the `DATABASE_URL` environment variable to your connection string.

### 3. Set JWT Secret

Generate a secure random string for `JWT_SECRET`:

```bash
openssl rand -base64 32
```

### 4. Create Admin Account

1. Open your deployed URL
2. Register the first account (this becomes the admin)
3. Registration is automatically disabled after admin creation
4. Admin can enable/disable registration in Settings

### 5. Add API Keys

1. Log in to the dashboard
2. Go to "API Keys" tab
3. Add your LLM provider API keys

### 6. Generate API Token

1. Go to "API Tokens" tab
2. Generate a token for your applications
3. Use the token to call the `/api/chat` endpoint

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing auth tokens (use a strong random value) |
| `REDIS_URL` | No | Redis URL (optional, for queue features) |
| `KEY_SELECTION_STRATEGY` | No | `exhaust-first` or `round-robin` (default: `exhaust-first`) |

---

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

---

## API Reference

### Authentication

All API endpoints (except `/health` and `/api/auth/*`) require a Bearer token:

```bash
curl -X POST https://your-instance.vercel.app/api/chat \
  -H "Authorization: Bearer llm_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

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
  "temperature": 0.7,
  "maxTokens": 1000
}
```

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
  }
}
```

**Response Headers:**

- `X-LLM-Provider`: Provider used
- `X-LLM-Model`: Model used
- `X-LLM-Key-ID`: API key ID used
- `X-LLM-Latency-Ms`: Request latency

### Key Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/keys` | List your API keys |
| POST | `/api/keys` | Add a new API key |
| DELETE | `/api/keys/:id` | Delete an API key |

### Token Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tokens` | List your API tokens |
| POST | `/api/tokens` | Generate a new token |
| DELETE | `/api/tokens/:id` | Revoke a token |

### Health Checks

| Endpoint | Description |
|----------|-------------|
| `/health` | Basic health check |
| `/health/ready` | Readiness (includes DB) |
| `/health/live` | Liveness check |

---

## Supported Providers

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

---

## Alternative Deployment Methods

### Local Development

```bash
# Clone the repository
git clone https://github.com/alicetears/llm-gateway.git
cd llm-gateway

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# Generate Prisma client and push schema
npm run db:generate
npm run db:push

# Start development server
npm run dev
```

### Docker

```bash
docker-compose up -d
```

### Docker Compose

The included `docker-compose.yml` provides:
- PostgreSQL database
- Redis (optional, for queue features)
- LLM Gateway API
- Queue worker

---

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NO_ELIGIBLE_KEY` | 400 | No API key available for request |
| `PROVIDER_ERROR` | 502 | LLM provider returned an error |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

---

## License

MIT

---

## Disclaimer

This software is provided "as is", without warranty of any kind. The author:

- Does **not** operate any hosted service
- Does **not** have access to your deployment
- Is **not** responsible for your use of this software
- Is **not** responsible for any costs, damages, or liabilities arising from your use

You are solely responsible for your deployment and its compliance with applicable laws and provider terms of service.
