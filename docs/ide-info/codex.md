# BMAD Method - Codex Instructions

## Activating Agents

BMAD agents, tasks and workflows are installed as custom prompts in
`$CODEX_HOME/prompts/bmad-*.md` files. If `CODEX_HOME` is not set, it
defaults to `$HOME/.codex/`.

## MCP Agent Mail (multi-agent communication)

Nếu bạn chạy nhiều agent BMAD song song và muốn chúng trao đổi qua một mailbox chung, hãy cấu hình `mcp_agent_mail` (MCP server):

- Repo: `https://github.com/steveyegge/mcp_agent_mail`
- Default URL: `http://127.0.0.1:8765/mcp/`

Gợi ý quy ước:

- `project_key` = absolute path repo
- `agent_name` = `bmad-{module}-{agent}`
- `thread_id` = ticket/work item

### Examples

```
/bmad-bmm-agents-dev - Activate development agent
/bmad-bmm-agents-architect - Activate architect agent
/bmad-bmm-workflows-dev-story - Execute dev-story workflow
```

### Notes

Prompts are autocompleted when you type /
Agent remains active for the conversation
Start a new conversation to switch agents
