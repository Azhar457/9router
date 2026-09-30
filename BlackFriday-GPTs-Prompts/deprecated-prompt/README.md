# Deprecated BlackFriday GPTs (8688 files)

Moved here from `../gpts/` on 2026-09-30. These are the uncurated bulk of the
BlackFriday-GPTs-Prompts collection (DAN-era, GPT-3.5/4o generation roleplay &
utility GPTs). They are **not registered** with the 9Router jailbreak payload
system — they ship in-repo only for history/reference.

## Why they were moved

- ~8700 entries, mostly generic "act as…" GPTs (SEO writers, tutors, RPGs,
  girlfriend characters, etc.).
- Outdated jailbreak mechanics (classic DAN, dev-mode, D-EvA) that modern
  model families (Claude 4.x/5.x, GPT-5.x/6, Grok 4.x) no longer fall for.
- The 12 curated survivors that DO still register live in `../gpts/`:

  pentest: un-ethical-ai, manipulation-gpt-x-dan-v13, blackhat-programmer-v1,
           blackhathacker, unlimited-hacking-ai, ultimate-hacking-ai-20-4
  coding:  chatgpt-jailbreak-dev-mode, coding-generator-jailbreak-70,
           codemaster-chatgpt-4-jailbreak
  nsfw:    yuri-the-unsatisfied, zero-two-your-horny-girlfriend,
           dark-roleplay-v10-base

## Registry

The active set is defined in `open-sse/rtk/jailbreakPayloads.js` →
`COLLECTIONS[bf].files[]`. Files in this folder are not read by the runtime.
