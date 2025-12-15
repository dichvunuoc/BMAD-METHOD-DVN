# Sprint Planning (Beads / bd)

<critical>The workflow execution engine is governed by: {project-root}/\_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {project-root}/\_bmad/bmm/workflows/4-implementation/sprint-planning-beads/workflow.yaml</critical>

<critical>
This workflow integrates with REAL Beads (steveyegge/beads) using the `bd` CLI.

- Canonical tracker: Beads issues + dependencies (epics are parent issues).
- Do NOT generate or rely on sprint-status.yaml.
- Never edit .beads/\* directly.

Minimum required commands:

- bd init
- bd create ... --json
- bd dep add ... --type parent-child
- bd label add ...
  </critical>

<workflow>

<step n="1" goal="Initialize Beads and load epics">
  <action>Ensure `bd` is installed and available on PATH; if not, HALT with installation instructions.</action>
  <action>Run `bd init` if this repo is not initialized with Beads.</action>
  <action>Load all epic files via input patterns (FULL_LOAD).</action>
  <action>If epics docs contain placeholders only (no real epics/stories), HALT and instruct to run PM `create-epics-and-stories` to produce real epic/story definitions.</action>
</step>

<step n="2" goal="Create bd epics + child story issues">
  <action>For each Epic found in epics docs:</action>
  <action>
    1) Create a Beads epic issue:
       - bd create "Epic: <epic title>" -t epic -p 2 -d "<epic summary>" --json
       - Capture returned epic_id

    2) For each Story under that epic:
       - bd create "Story: <story title>" -t task -p 2 -d "<short story summary>" --json
       - Capture returned story_id
       - Link story as child of epic:
         - bd dep add <epic_id> <story_id> --type parent-child
       - Add labels for filtering:
         - bd label add <story_id> bmad-story
         - bd label add <story_id> epic-<N>
          - bd label add <story_id> needs-spec
          - (optional) bd label add <story_id> ready-for-dev  # ONLY after spec is attached by create-story-beads

  </action>
  <output>✅ Sprint planning complete (Beads). Epics and stories exist as bd issues. Use `bd ready` to find next work.</output>
</step>

</workflow>
