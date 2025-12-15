# Sprint Planning (Beads-first)

<critical>The workflow execution engine is governed by: {project-root}/\_bmad/core/tasks/workflow.xml</critical>
<critical>You MUST have already loaded and processed: {project-root}/\_bmad/bmm/workflows/4-implementation/sprint-planning-beads/workflow.yaml</critical>
<critical>
Beads-first mode:

- Sprint tracking is stored in Beads under namespace `sprint`, key `development_status`.
- DO NOT generate or rely on sprint-status.yaml.
- Never edit Beads storage files directly.
- Run `bmad beads land` before/after updating Beads.
  </critical>

<workflow>

<step n="1" goal="Load epics and extract stories">
  <action>Run: {beads.cli.init}</action>
  <action>Run: {beads.cli.land}</action>
  <action>Load all epic files via input patterns (FULL_LOAD)</action>
  <action>From epics content, extract all stories and normalize story keys to format: epic-story-kebab-case (e.g., 1-1-snake-movement)</action>
  <action>If no real epic/story definitions are present (placeholders only), HALT with a message to run PM `create-epics-and-stories` first.</action>
</step>

<step n="2" goal="Write sprint tracking into Beads">
  <action>Build development_status map with keys for all stories. Default status = "backlog".</action>
  <action>Write to Beads:
    - bmad beads set sprint development_status <json>
    - bmad beads append sprint journal {"event":"sprint-planning","ts":"{date}","storyCount":N}
  </action>
  <action>Run: {beads.cli.land}</action>
  <output>✅ Sprint planning complete (Beads-first). Tracking stored in Beads: sprint.development_status</output>
</step>

</workflow>
