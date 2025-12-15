# BMAD Method - Cursor Instructions

## Activating Agents

BMAD agents are installed in `.cursor/rules/bmad/` as MDC rules.

## MCP Agent Mail (kênh giao tiếp giữa nhiều agent BMAD)

Nếu bạn chạy **nhiều phiên agent** (ví dụ: nhiều chat/session/terminal) và muốn chúng trao đổi “inbox/outbox + thread + file reservation”, bạn có thể dùng `mcp_agent_mail` làm “bus” chung.

- **Upstream**: `https://github.com/steveyegge/mcp_agent_mail`
- **MCP server name (gợi ý)**: `mcp-agent-mail`
- **Default URL**: `http://127.0.0.1:8765/mcp/`

### Cấu hình MCP cho Cursor

Thêm một server entry tương đương mẫu `cursor.mcp.json` của upstream:

```json
{
  "mcpServers": {
    "mcp-agent-mail": {
      "type": "http",
      "url": "http://127.0.0.1:8765/mcp/",
      "headers": { "Authorization": "Bearer ${MCP_AGENT_MAIL_TOKEN}" }
    }
  }
}
```

### Quy ước đặt tên để các agent “nói chuyện” đúng kênh

- **project_key**: đường dẫn tuyệt đối tới repo (tất cả agent dùng cùng `project_key`).
- **agent_name**: theo rule của `mcp_agent_mail` nên dùng dạng adjective+noun (vd `BlueLake`, `RedFox`). Dùng `task_description` để ghi vai trò (vd “BMAD SM1 create-story-beads”).
- **thread_id**: ticket/work item (vd `FEAT-123`, `party-mode:auth`).

### How to Use

1. **Reference in Chat**: Use `@_bmad/{module}/agents/{agent-name}`
2. **Include Entire Module**: Use `@_bmad/{module}`
3. **Reference Index**: Use `@_bmad/index` for all available agents

### Examples

```
@_bmad/core/agents/dev - Activate dev agent
@_bmad/bmm/agents/architect - Activate architect agent
@_bmad/core - Include all core agents/tasks
```

### Notes

- Rules are Manual type - only loaded when explicitly referenced
- No automatic context pollution
- Can combine multiple agents: `@_bmad/core/agents/dev @_bmad/core/agents/test`
