# Strix Security Payloads for 9router

**Purpose:** Integrate Strix's comprehensive security testing knowledge into the 9router RTK payload catalog.

Strix is an AI-powered security testing framework with deep expertise across vulnerabilities, frameworks, cloud platforms, and penetration testing workflows. This directory contains Strix's knowledge base migrated and structured for 9router consumption.

---

## Directory Structure

```
strix-payloads/
├── skills/
│   ├── vulnerabilities/     # Vulnerability-specific testing skills (XSS, SQLi, SSTI, SSRF, etc.)
│   ├── frameworks/          # Framework-specific security knowledge (Next.js, FastAPI, Django, NestJS)
│   ├── technologies/        # Technology-specific testing patterns (React, GraphQL, WebSockets, etc.)
│   ├── protocols/           # Protocol security (OAuth, JWT, SAML, gRPC, etc.)
│   ├── cloud/               # Cloud platform security (AWS, Azure, GCP, Kubernetes)
│   ├── tooling/             # Security testing tools and automation
│   ├── reconnaissance/      # Information gathering and enumeration
│   ├── custom/              # Custom testing methodologies
│   ├── coordination/        # Multi-phase testing orchestration
│   └── analysis/            # Vulnerability analysis and reporting
├── top-level-skills/        # High-level testing workflows (API security, pentesting, OWASP Top 10)
├── INTEGRATION.md           # Migration manifest and RTK conversion roadmap
└── README.md                # This file
```

---

## Skill Categories

### Vulnerabilities (6 skills)
Deep knowledge of specific vulnerability classes:
- **Agentic System Security** — AI agent prompt injection, context poisoning, tool abuse
- **XSS** — Cross-site scripting detection and exploitation
- **SSTI** — Server-side template injection
- **LLM Prompt Injection** — LLM-specific attack vectors
- **SQL Injection** — Database injection patterns
- **SSRF** — Server-side request forgery

### Frameworks (4 skills)
Framework-specific security testing:
- **Next.js** — React SSR/SSG security patterns
- **FastAPI** — Python async API security
- **Django** — Python web framework security
- **NestJS** — TypeScript enterprise API security

### Cloud (4 skills)
Cloud platform security:
- **Kubernetes** — Container orchestration security
- **AWS** — Amazon Web Services security
- **Azure** — Microsoft Azure security
- **GCP** — Google Cloud Platform security

### Top-Level Skills (9 workflows)
End-to-end testing workflows:
- **API Security Testing** — REST/GraphQL API security audits
- **Application Security Testing** — Full-stack application security
- **CI Security Scanning** — Automated security in CI/CD pipelines
- **Find Security Vulnerabilities** — Vulnerability discovery workflows
- **Fix Security Vulnerabilities** — Remediation guidance and code fixes
- **Managed Pentesting** — Structured penetration testing methodology
- **OWASP Top 10 Testing** — OWASP Top 10 compliance audits
- **Penetration Testing** — Comprehensive pentesting workflows
- **Web App Penetration Testing** — Web application pentesting

---

## Using Strix Payloads with 9router

### As a Skill Reference

Read skill files directly for security testing guidance:

```bash
cat strix-payloads/skills/vulnerabilities/sql_injection.md
cat strix-payloads/top-level-skills/api-security-testing.md
```

### As RTK Payloads (Phase 2)

Once converted to RTK payload format, invoke via 9router:

```typescript
import { router } from '9router';

// Load Strix SQL injection testing payload
const payload = await router.getPayload('strix:vuln:sql_injection');

// Execute security test
const result = await router.execute(payload, {
  target: 'https://api.example.com',
  endpoint: '/users',
  method: 'POST'
});
```

### Payload ID Convention

Strix payloads follow the naming pattern:

```
strix:<category>:<skill_name>
```

Examples:
- `strix:vuln:xss`
- `strix:frameworks:nextjs`
- `strix:cloud:kubernetes`
- `strix:top-level:managed-pentesting-with-strix`

---

## Integration Status

**Phase 1 (Complete):** High-priority skills migrated (23 files)
- ✅ 6 vulnerability skills
- ✅ 4 framework skills
- ✅ 4 cloud skills
- ✅ 9 top-level workflow skills

**Phase 2 (Pending):** Remaining internal skills (56+ files)
- ⏳ Technologies (React, GraphQL, WebSockets, etc.)
- ⏳ Protocols (OAuth, JWT, SAML, etc.)
- ⏳ Tooling (Burp Suite, OWASP ZAP, etc.)
- ⏳ Reconnaissance (subdomain enumeration, port scanning, etc.)
- ⏳ Custom methodologies
- ⏳ Coordination workflows
- ⏳ Analysis and reporting

**Phase 3 (Future):** RTK payload conversion and catalog registration

---

## Documentation

- **Full Audit:** `../STRIX_AUDIT.md` — Complete analysis of Strix capabilities and integration plan
- **Integration Manifest:** `INTEGRATION.md` — File mapping and RTK conversion roadmap
- **Strix Source:** `/mnt/data_d/Projects/strix/` — Original Strix repository

---

## Contributing

To add new Strix skills:

1. **Copy skill file** — Place in appropriate category subdirectory
2. **Update INTEGRATION.md** — Add file mapping entry
3. **Register RTK payload** — Add payload entry to 9router catalog (Phase 3)

---

**Last Updated:** 2026-10-04  
**Strix Version:** Latest  
**Integration Phase:** 1 (Complete)
