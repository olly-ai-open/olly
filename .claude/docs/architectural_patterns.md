# Architectural Patterns

This document describes the architectural patterns and conventions used across the Olly codebase.

---

## 1. Dependency Injection via Explicit Parameters

Core functions receive dependencies (especially `PrismaClient`) as explicit parameters rather than importing singletons.

**Why**: Enables testability, allows sharing core logic between web and Lambda apps without coupling to specific client instances.

**Examples**:
- `packages/core/src/core/people-core.ts:3` - `async function findPeople(prisma: PrismaClient, ...)`
- `packages/core/src/core/google-core.ts:5` - All functions receive prisma explicitly
- `apps/web/src/lib/settings.ts:1` - Thin wrapper that injects prisma from `apps/web/src/lib/prisma.ts`

---

## 2. Layered Architecture (Core / HTTP / Service)

Clear separation between layers:
- **Core** (`packages/core/src/core/*-core.ts`): Pure business logic, no HTTP concerns
- **HTTP** (`packages/core/src/google-http.ts`, `slack-http.ts`): API client implementations
- **Service** (`apps/web/src/lib/*.ts`): Thin wrappers that inject dependencies

**Why**: Core logic is reusable across web and worker apps. HTTP details are isolated. Service layer provides app-specific configuration.

**Examples**:
- `packages/core/src/core/meetings-core.ts:1` - Domain logic for meetings
- `packages/core/src/google-http.ts:1` - Google API HTTP calls
- `apps/web/src/lib/google.ts:1` - Service wrapper with token management

---

## 3. Agent-Tool Framework

Extensible AI agent system with composable tools. Base `Agent` class orchestrates LLM calls with tool execution.

**Components**:
- `BaseAgent`: Abstract class managing conversation, tools, memory, and telemetry
- `Tool`: Interface for capabilities (Zod schema + execute function)
- `Personas`: Specialized agents (MeetingPrep, MorningBrief, EndOfDay)

**Why**: Modular design allows adding new capabilities without modifying agent core. Tools are testable independently.

**Examples**:
- `packages/core/src/agents/base/Agent.ts:1` - Base agent with tool loop (max 5 roundtrips)
- `packages/core/src/agents/base/Tool.ts:22` - Tool interface with Zod schema
- `packages/core/src/agents/tools/CalendarTool.ts:9` - Zod schema for calendar queries
- `packages/core/src/agents/personas/MeetingPrepAgent.ts:1` - Agent composing multiple tools

---

## 4. Zod Schema Validation

Runtime validation using Zod schemas with TypeScript type inference.

**Use Cases**:
- Tool input parameters (agents)
- LLM output parsing (with fallback extraction)
- API request bodies

**Examples**:
- `packages/core/src/agents/tools/CalendarTool.ts:9-16` - Tool parameter schema
- `packages/core/src/llm.ts:13-26` - `safeParseBriefJSON()` extracts JSON from markdown fences
- `packages/core/src/agents/base/Tool.ts:22` - `z.ZodType<any>` in interface

---

## 5. Prisma Singleton with Field Encryption

Single Prisma client instance per runtime, extended with field-level encryption for sensitive data.

**Why**: Prevents connection pool exhaustion in serverless environments. Transparent encryption for credentials.

**Implementation**:
- Global cache with lazy initialization
- Extension from `prisma-field-encryption`
- Separate initialization for Lambda vs web

**Examples**:
- `apps/web/src/lib/prisma.ts:4-30` - Web app singleton with encryption
- `packages/core/src/prisma-lambda.ts:4-30` - Lambda-specific with promise-based init
- `apps/web/prisma/schema.prisma:1` - Schema with `/// @encrypted` annotations

---

## 6. NextAuth with OAuth Token Refresh

Authentication using NextAuth with Google OAuth provider. Tokens stored in Account model and refreshed on demand.

**Flow**:
1. User authenticates via Google OAuth
2. Tokens stored via PrismaAdapter
3. Access token refreshed before each API call if expired
4. Scope checks determine feature availability

**Examples**:
- `apps/web/src/lib/auth.ts:6-38` - NextAuth config with JWT callbacks
- `apps/web/src/lib/google.ts:49-59` - `getValidAccessToken()` refresh logic
- `apps/web/src/lib/google.ts:61-119` - `checkGoogleHealth()` validates scopes

---

## 7. Semantic Error Types

Named error strings thrown and caught for specific handling (e.g., re-authentication flows).

**Why**: Enables client-specific error handling without exception class hierarchies. Clear error conditions.

**Common Errors**:
- `"REAUTH_REQUIRED"` - OAuth token invalid, user must re-authenticate
- `"token_revoked"` - Slack token revoked
- `"invalid_grant"` - Google refresh token invalid

**Examples**:
- `packages/core/src/core/google-core.ts:24-80` - Throws `"REAUTH_REQUIRED"` on token refresh failure
- `packages/core/src/core/slack-core.ts:14-56` - Checks `error === "token_revoked"`

---

## 8. Langfuse Telemetry with Lazy Initialization

LLM observability using Langfuse SDK. Initialized lazily based on configuration.

**Features**:
- Conditional initialization (only when enabled)
- User/session context propagation
- Tool execution tracing
- Metrics aggregation to database

**Examples**:
- `packages/core/src/telemetry/langfuse.ts:19-57` - `ensureLangfuseInitialized()` with enabled check
- `packages/core/src/telemetry/langfuse.ts:59-107` - `withLangfuseTrace()` wrapper
- `packages/core/src/agents/base/Tool.ts:40-57` - Tool execution traced with start/end times

---

## 9. AWS SSM Parameter Store for Configuration

Environment variables loaded from SSM with stage-based paths (`/olly/{stage}/{KEY}`).

**Categories**:
- Required: App fails to start if missing
- Optional: Logged warning, app continues

**Examples**:
- `apps/web/src/lib/init-env.ts:8-131` - Full parameter loading with validation
- `apps/web/src/lib/init-env.ts:37-103` - Centralized key definitions
- `packages/core/src/llm.ts:7-11` - Lazy `getOpenAI()` checks env var

---

## 10. SQS Job Queue Pattern

Async job processing via SQS with scheduler/worker separation.

**Components**:
- **Scheduler**: EventBridge trigger → queries due jobs → enqueues to SQS
- **Worker**: SQS trigger → processes batch → updates job status
- **Dead Letter Queue**: Failed jobs after 5 retries

**Examples**:
- `apps/scheduler/src/index.ts:1` - Scheduler handler
- `apps/worker/src/index.ts:1` - Worker handler
- `packages/core/src/jobs.ts:1` - Job execution logic by type
- `infra/lib/olly-jobs-stack.ts:1` - CDK queue configuration
