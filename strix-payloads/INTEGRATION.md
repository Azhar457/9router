# Strix → 9router Integration Manifest

**Migration Date:** 2026-10-04  
**Status:** Phase 1 Complete  
**Total Files Migrated:** 23

---

## File Mapping Table

### Vulnerability Skills (6 files)

| Source | Destination | Size |
|--------|-------------|------|
| `strix/strix/skills/vulnerabilities/agentic_system_security.md` | `skills/vulnerabilities/agentic_system_security.md` | 17k |
| `strix/strix/skills/vulnerabilities/xss.md` | `skills/vulnerabilities/xss.md` | 7.9k |
| `strix/strix/skills/vulnerabilities/ssti.md` | `skills/vulnerabilities/ssti.md` | 19k |
| `strix/strix/skills/vulnerabilities/llm_prompt_injection.md` | `skills/vulnerabilities/llm_prompt_injection.md` | 11k |
| `strix/strix/skills/vulnerabilities/sql_injection.md` | `skills/vulnerabilities/sql_injection.md` | 8.5k |
| `strix/strix/skills/vulnerabilities/ssrf.md` | `skills/vulnerabilities/ssrf.md` | 8.5k |

### Framework Skills (4 files)

| Source | Destination | Size |
|--------|-------------|------|
| `strix/strix/skills/frameworks/nextjs.md` | `skills/frameworks/nextjs.md` | 11k |
| `strix/strix/skills/frameworks/fastapi.md` | `skills/frameworks/fastapi.md` | 8.4k |
| `strix/strix/skills/frameworks/django.md` | `skills/frameworks/django.md` | 11k |
| `strix/strix/skills/frameworks/nestjs.md` | `skills/frameworks/nestjs.md` | 12k |

### Cloud Skills (4 files)

| Source | Destination | Size |
|--------|-------------|------|
| `strix/strix/skills/cloud/kubernetes.md` | `skills/cloud/kubernetes.md` | 12k |
| `strix/strix/skills/cloud/aws.md` | `skills/cloud/aws.md` | 10k |
| `strix/strix/skills/cloud/azure.md` | `skills/cloud/azure.md` | 21k |
| `strix/strix/skills/cloud/gcp.md` | `skills/cloud/gcp.md` | 7.9k |

### Top-Level Skills (9 files)

| Source | Destination | Size |
|--------|-------------|------|
| `strix/skills/api-security-testing/SKILL.md` | `top-level-skills/api-security-testing.md` | 6.3k |
| `strix/skills/application-security-testing/SKILL.md` | `top-level-skills/application-security-testing.md` | 4.6k |
| `strix/skills/ci-security-scanning-with-strix/SKILL.md` | `top-level-skills/ci-security-scanning-with-strix.md` | 9.0k |
| `strix/skills/find-security-vulnerabilities-in-code/SKILL.md` | `top-level-skills/find-security-vulnerabilities-in-code.md` | 4.4k |
| `strix/skills/fix-security-vulnerabilities-with-strix/SKILL.md` | `top-level-skills/fix-security-vulnerabilities-with-strix.md` | 6.0k |
| `strix/skills/managed-pentesting-with-strix/SKILL.md` | `top-level-skills/managed-pentesting-with-strix.md` | 24k |
| `strix/skills/owasp-top-10-testing/SKILL.md` | `top-level-skills/owasp-top-10-testing.md` | 6.2k |
| `strix/skills/penetration-testing-with-strix/SKILL.md` | `top-level-skills/penetration-testing-with-strix.md` | 10k |
| `strix/skills/web-app-penetration-testing/SKILL.md` | `top-level-skills/web-app-penetration-testing.md` | 4.3k |

---

## Integration Status

| Category | Planned | Migrated | Status |
|----------|---------|----------|--------|
| Vulnerabilities | 6 | 6 | ✅ Complete |
| Frameworks | 4 | 4 | ✅ Complete |
| Cloud | 4 | 4 | ✅ Complete |
| Top-Level Skills | 9 | 9 | ✅ Complete |
| Technologies | 0 | 0 | ⏳ Phase 2 |
| Protocols | 0 | 0 | ⏳ Phase 2 |
| Tooling | 0 | 0 | ⏳ Phase 2 |
| Reconnaissance | 0 | 0 | ⏳ Phase 2 |
| Custom | 0 | 0 | ⏳ Phase 2 |
| Coordination | 0 | 0 | ⏳ Phase 2 |
| Analysis | 0 | 0 | ⏳ Phase 2 |

---

## Next Steps: RTK Payload Conversion

Phase 2 converts these migrated skill files into 9router RTK payload format:

1. **Parse skill metadata** — extract `description`, `triggers`, `context_requirements`, and `output_schema` from each SKILL.md front-matter.
2. **Map to RTK payload schema** — each skill becomes a payload entry in 9router's catalog with:
   - `payload_id`: derived from filename (e.g., `strix:vuln:sql_injection`)
   - `category`: matches the subdirectory (`vulnerabilities`, `frameworks`, `cloud`, etc.)
   - `source`: `strix`
   - `skill_path`: relative path within `strix-payloads/`
   - `priority`: Phase 1 skills default to `high`
3. **Register in 9router payload catalog** — add entries to the router's payload index so they are discoverable at runtime.
4. **Phase 2 skills to migrate** — remaining Strix internal skills in `technologies/`, `protocols/`, `tooling/`, `reconnaissance/` directories (56+ files).

### RTK Payload ID Convention

```
strix:<category>:<skill_name>
```

Examples:
- `strix:vuln:sql_injection`
- `strix:vuln:agentic_system_security`
- `strix:frameworks:nextjs`
- `strix:cloud:kubernetes`
- `strix:top-level:managed-pentesting-with-strix`

---

## Source Reference

Full audit documentation: `../STRIX_AUDIT.md`  
Strix source root: `/mnt/data_d/Projects/strix/`
