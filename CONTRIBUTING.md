# Contributing

## Source Code Changes

**Accepted:** Bug fixes, security fixes, simplifications, reducing code.

**Not accepted:** Features, capabilities, compatibility, enhancements. These should be skills.

## Skills

A skill lives in `.claude/skills/<name>/` and teaches Claude Code how to transform a NanoClaw installation. A PR that contributes a skill should not modify any source files outside `.claude/skills/`.

Two formats are accepted:

**Instruction-based (simple):** A `SKILL.md` that contains the steps Claude follows to add the feature. Claude reads the instructions and applies changes manually. See `/add-telegram` for a good example.

**Package-based (nanorepo):** A `SKILL.md` + `manifest.yaml` + pre-built code package that the [skills-engine](skills-engine/) applies deterministically via three-way merge. Use this format when the skill modifies multiple source files and needs to compose safely with other skills. The manifest declares `adds:`, `modifies:`, `structured:` sections; pre-built files go in `add/` and `modify/` subdirectories.

When in doubt, start with the instruction-based format. Upgrade to package-based if the skill becomes complex or if deterministic replayability matters.

### Why?

Every user should have clean and minimal code that does exactly what they need. Skills let users selectively add features to their fork without inheriting code for features they don't want.

### Testing

Test your skill by running it on a fresh clone before submitting. For package-based skills, also run `npx tsx scripts/apply-skill.ts --skill <name>` and verify the applied result passes tests.
