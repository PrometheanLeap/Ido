# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest `main` | ✅ |
| Tagged releases | ✅ |
| Older versions | ❌ |

## Reporting a vulnerability

If you discover a security vulnerability in Ido, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly with details of the vulnerability
3. Include steps to reproduce, impact assessment, and suggested fix if available
4. You will receive a response within 48 hours

Please include:
- Ido version (`curl http://localhost:8645/api/v1/health`)
- Deployment mode (`IDO_MODE`)
- Whether authentication was required to exploit the issue
- Steps to reproduce

## Security measures

Ido implements the following security measures:

- **Authentication**: JWT sessions (HttpOnly, SameSite=Lax cookies) + OIDC (Google/Microsoft)
- **API key hashing**: SHA-256 hashed at rest, never stored in plaintext
- **Tenant isolation**: All queries are scoped by `tenant_id`; corporate mode adds `user_id` scoping
- **Rate limiting**: Auth routes (20/min default), protocol endpoints (600/min default)
- **Input validation**: All API payloads validated with Zod schemas before processing
- **SQL injection**: Kysely query builder parameterises all queries
- **XSS prevention**: React auto-escaping; no `dangerouslySetInnerHTML` without sanitisation
- **Security headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, CSP
- **Body size limit**: 1MB max request body
- **Secrets**: JWT secret and VAPID keys auto-generated and persisted to disk; never logged
