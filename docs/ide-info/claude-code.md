# BMAD Method - Claude Code Instructions

## Activating Agents

BMAD agents are installed as slash commands in `.claude/commands/bmad/`.

## MCP Agent Mail (multi-agent inbox/outbox)

Để các agent BMAD chạy ở **nhiều session khác nhau** có thể phối hợp (threads + file reservations), bạn có thể dùng `mcp_agent_mail`:

- Repo: `https://github.com/steveyegge/mcp_agent_mail`
- Default URL: `http://127.0.0.1:8765/mcp/`
- Server name (gợi ý): `mcp-agent-mail`

Khi đã cấu hình MCP cho Claude Code, hãy dùng cùng quy ước:

- `project_key` = đường dẫn tuyệt đối repo
- `agent_name` = `bmad-{module}-{agent}`
- `thread_id` = ticket/work item

### How to Use

1. **Type Slash Command**: Start with `/` to see available commands
2. **Select Agent**: Type `/bmad-{agent-name}` (e.g., `/bmad-dev`)
3. **Execute**: Press Enter to activate that agent persona

### Examples

```
/bmad:bmm:agents:dev - Activate development agent
/bmad:bmm:agents:architect - Activate architect agent
/bmad:bmm:workflows:dev-story - Execute dev-story workflow
```

### Notes

- Commands are autocompleted when you type `/`
- Agent remains active for the conversation
- Start a new conversation to switch agents
