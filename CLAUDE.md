# Olly

AI-powered productivity assistant that generates intelligent briefings from calendar, emails, and work integrations.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4 |
| Backend | Next.js API routes, Node.js 22 |
| Database | PostgreSQL + Prisma ORM 6.18 (with field encryption) |
| Infrastructure | AWS CDK, Lambda, SQS, EventBridge, S3, SSM |
| AI/LLM | OpenAI API, Vercel AI SDK |
| Observability | Langfuse (LLM tracing), New Relic |
| Auth | NextAuth 5 (Google OAuth) |
| Integrations | Slack, Google Workspace (Calendar, Gmail, Drive) |

## Project Structure

```
olly/
├── apps/
│   ├── web/           # Next.js web app (frontend + API)
│   ├── scheduler/     # Lambda: schedules jobs (runs every minute via EventBridge)
│   └── worker/        # Lambda: processes jobs from SQS
├── packages/
│   └── core/          # Shared business logic, agents, tools
└── infra/             # AWS CDK infrastructure definitions
```

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `apps/web/src/app/` | Next.js App Router pages and API routes |
| `apps/web/src/components/` | React components |
| `apps/web/src/lib/` | Service wrappers (thin layer over core) |
| `apps/web/prisma/` | Database schema and migrations |
| `packages/core/src/agents/` | AI agent framework (base classes, tools, personas) |
| `packages/core/src/core/` | Domain logic (*-core.ts files) |
| `packages/core/src/prompts/` | LLM prompt templates |
| `packages/core/src/telemetry/` | Langfuse integration |
| `infra/lib/` | CDK stack definitions |

## Essential Commands

### Development (from `apps/web/`)
```bash
npm run dev              # Start dev server with TypeScript watching
npm run build            # Production build
npm run lint             # ESLint check
npm run lint:fix         # ESLint auto-fix
npm run typecheck        # Full TypeScript check
npm run format           # Prettier format
```

### Database (from `apps/web/`)
```bash
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run migrations
```

### Infrastructure (from `infra/`)
```bash
npm run synth            # Synthesize CloudFormation
npm run deploy           # Deploy to AWS
```

### Root
```bash
npm run sync-env         # Sync environment variables from SSM
npm run sync-env:prod    # Sync production env vars
```

## Architecture Overview

### Job Processing Pipeline
1. **Scheduler Lambda** (EventBridge, every minute) → enqueues due jobs to SQS
2. **SQS Queue** → buffers jobs with dead-letter queue (5 retries)
3. **Worker Lambda** (SQS trigger, batch 10) → executes job logic

### Job Types
- `MORNING_BRIEF` - Daily morning summary
- `EVENING_BRIEF` - End-of-day recap
- `MEETING_BRIEF` - Pre-meeting preparation (5 min before)
- `CALENDAR_SYNC` - Hourly calendar refresh

### Agent Framework
Base `Agent` class with composable `Tool` system. See `packages/core/src/agents/README.md:1` for details.

**Personas**: `MeetingPrepAgent`, `MorningBriefAgent`, `EndOfDayBriefAgent`
**Tools**: `CalendarTool`, `EmailTool`, `DriveTool`, `SlackTool`

## Key Files Reference

| File | Purpose |
|------|---------|
| `apps/web/src/lib/auth.ts:1` | NextAuth configuration |
| `apps/web/src/lib/prisma.ts:1` | Prisma client singleton |
| `apps/web/src/lib/init-env.ts:1` | SSM parameter loading |
| `packages/core/src/jobs.ts:1` | Job execution logic |
| `packages/core/src/llm.ts:1` | OpenAI/LLM utilities |
| `packages/core/src/agents/base/Agent.ts:1` | Base agent class |
| `packages/core/src/agents/base/Tool.ts:1` | Tool interface |
| `infra/lib/olly-jobs-stack.ts:1` | CDK infrastructure stack |
| `apps/web/prisma/schema.prisma:1` | Database schema |

## Environment Variables

Required keys are loaded from AWS SSM at `/olly/{stage}/{KEY}`. See `apps/web/src/lib/init-env.ts:37` for the full list including:
- Database: `DATABASE_URL`, `PRISMA_FIELD_ENCRYPTION_KEY`
- Auth: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- AI: `OPENAI_API_KEY`, `LANGFUSE_*`
- Integrations: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`

## Additional Documentation

Check these files for specialized topics:

| Topic | File |
|-------|------|
| Architectural Patterns | `.claude/docs/architectural_patterns.md` |
| Agent Framework | `packages/core/src/agents/README.md` |
| Integration Setup | `apps/web/README.md` |
