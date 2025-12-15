const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { McpHttpClient } = require('./mcp-http-client');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function runCapture(projectRoot, cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: projectRoot, shell: false });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (err += String(d)));
    child.on('exit', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

async function runAgentJob({ projectRoot, prompt, logsDir }) {
  const cmd = process.env.BMAD_RUNNER_CMD;
  const rawArgs = process.env.BMAD_RUNNER_ARGS;
  if (!cmd || !rawArgs) {
    throw new Error('Missing runner configuration. Set BMAD_RUNNER_CMD and BMAD_RUNNER_ARGS for SM1.');
  }

  const args = safeJsonParse(rawArgs);
  if (!Array.isArray(args)) {
    throw new TypeError('BMAD_RUNNER_ARGS must be a JSON array.');
  }

  ensureDir(logsDir);
  const promptFile = path.join(logsDir, `prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  const actualArgs = args.map((a) => (typeof a === 'string' ? a.replaceAll('{PROMPT_FILE}', promptFile) : a));
  const exitCode = await new Promise((resolve) => {
    const child = spawn(cmd, actualArgs, { cwd: projectRoot, stdio: 'inherit', shell: false });
    child.on('exit', (code) => resolve(code ?? 1));
  });

  return { exitCode, promptFile };
}

function extractIssueIdList(jsonPayload) {
  if (!jsonPayload) return [];
  if (Array.isArray(jsonPayload)) {
    return jsonPayload.map((x) => x?.id ?? x?.issue_id ?? x?.key).filter(Boolean);
  }
  if (jsonPayload.issues && Array.isArray(jsonPayload.issues)) {
    return jsonPayload.issues.map((x) => x?.id ?? x?.issue_id ?? x?.key).filter(Boolean);
  }
  return [];
}

async function main() {
  const projectRoot = process.env.BMAD_PROJECT_ROOT || process.cwd();
  const projectKey = process.env.BMAD_PROJECT_KEY || projectRoot;

  const mcpUrl = process.env.BMAD_MCP_AGENT_MAIL_URL || 'http://127.0.0.1:8765/mcp/';
  const tokenEnv = process.env.BMAD_MCP_AGENT_MAIL_TOKEN_ENV || 'MCP_AGENT_MAIL_TOKEN';
  const token = process.env[tokenEnv];

  const agentName = process.env.BMAD_AGENT_MAIL_NAME;
  const program = process.env.BMAD_WORKER_PROGRAM || 'bmad-sm1';
  const model = process.env.BMAD_WORKER_MODEL || 'unknown';
  const taskDescription = process.env.BMAD_WORKER_TASK_DESCRIPTION || 'BMAD SM1 create-story-beads';

  const sm2Agent = process.env.BMAD_SM2_AGENT_MAIL_NAME;
  const dev1Agent = process.env.BMAD_DEV1_AGENT_MAIL_NAME;
  const dev2Agent = process.env.BMAD_DEV2_AGENT_MAIL_NAME;

  if (!agentName || !sm2Agent || !dev1Agent || !dev2Agent) {
    throw new Error(
      'Missing one of BMAD_AGENT_MAIL_NAME / BMAD_SM2_AGENT_MAIL_NAME / BMAD_DEV1_AGENT_MAIL_NAME / BMAD_DEV2_AGENT_MAIL_NAME.',
    );
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const mcp = new McpHttpClient({ url: mcpUrl, headers });

  await mcp.callTool('health_check', {});
  await mcp.callTool('ensure_project', { human_key: projectKey });
  await mcp.callTool('register_agent', {
    project_key: projectKey,
    program,
    model,
    name: agentName,
    task_description: taskDescription,
  });
  await mcp.callTool('set_contact_policy', { project_key: projectKey, agent_name: agentName, policy: 'open' });

  // Make sure contact enforcement doesn't block the chain.
  for (const nm of [sm2Agent, dev1Agent, dev2Agent]) {
    try {
      await mcp.callTool('set_contact_policy', { project_key: projectKey, agent_name: nm, policy: 'open' });
    } catch {
      // ignore if not registered yet
    }
  }

  const pollMs = Number.parseInt(process.env.BMAD_POLL_MS || '2000', 10);
  const logsDir = path.join(projectRoot, '.bmad', 'impl-4agent-beads', 'logs', 'sm1');
  ensureDir(logsDir);

  let sinceTs = null;
  let activeIssue = null;

  while (true) {
    // If no active work, pick next issue from Beads queue.
    if (!activeIssue) {
      // Ensure bd is initialized (best-effort)
      await runCapture(projectRoot, 'bd', ['init']);

      // 1) needs-spec
      const needsSpec = await runCapture(projectRoot, 'bd', ['list', '--status', 'open', '--label', 'bmad-story,needs-spec', '--json']);
      const needsSpecJson = safeJsonParse(needsSpec.out);
      const ids = extractIssueIdList(needsSpecJson);

      if (ids.length === 0) {
        // Nothing to do; wait.
        await sleep(pollMs);
        continue;
      }

      activeIssue = ids[0];

      const prompt = [
        `You are SM1 in automation mode. Do NOT ask the human anything.`,
        `Project root: ${projectRoot}`,
        `Beads issue_id: ${activeIssue}`,
        ``,
        `Run BMAD Beads-first workflow: create-story-beads.`,
        `Workflow file: ${projectRoot}/_bmad/bmm/workflows/4-implementation/create-story-beads/workflow.yaml`,
        ``,
        `Constraints:`,
        `- Use bd CLI only; never edit .beads/* directly.`,
        `- Force selection to issue_id ${activeIssue}.`,
        `- Produce a short summary and exit.`,
      ].join('\n');

      const { exitCode, promptFile } = await runAgentJob({ projectRoot, prompt, logsDir });

      // Dispatch validation job to SM2
      const job = {
        issue_id: activeIssue,
        step: 'validate-create-story-beads',
        thread_id: String(activeIssue),
        to_role: 'sm2',
        to_agent_name: sm2Agent,
        next_step: 'dev-story-beads',
        next_role: 'dev1',
        next_agent_name: dev1Agent,
        next_next_step: 'code-review-beads',
        next_next_role: 'dev2',
        next_next_agent_name: dev2Agent,
        done_to_role: 'sm1',
        done_to_agent_name: agentName,
        meta: { sm1_runner_exit_code: exitCode, sm1_prompt_file: promptFile },
      };

      await mcp.callTool('send_message', {
        project_key: projectKey,
        sender_name: agentName,
        to: [sm2Agent],
        subject: `BMAD JOB: validate-create-story-beads ${activeIssue}`,
        body_md: `\`\`\`json\n${JSON.stringify(job, null, 2)}\n\`\`\`\n`,
        thread_id: String(activeIssue),
        auto_contact_if_blocked: true,
      });
    }

    // Wait for DONE from dev2 for this active issue.
    /** @type {any[]} */
    const msgs = await mcp.callTool('fetch_inbox', {
      project_key: projectKey,
      agent_name: agentName,
      limit: 20,
      include_bodies: true,
      ...(sinceTs ? { since_ts: sinceTs } : {}),
    });

    for (const msg of msgs) {
      if (msg && msg.created_ts) {
        if (!sinceTs) {
          sinceTs = msg.created_ts;
        } else if (msg.created_ts > sinceTs) {
          sinceTs = msg.created_ts;
        }
      }
    }

    for (const msg of msgs) {
      if (!msg || typeof msg.subject !== 'string') continue;
      if (!msg.subject.startsWith('BMAD DONE:')) continue;
      if (!activeIssue) continue;
      if (!msg.subject.includes(String(activeIssue))) continue;

      if (msg.id) {
        try {
          await mcp.callTool('acknowledge_message', { project_key: projectKey, agent_name: agentName, message_id: msg.id });
        } catch {
          // ignore
        }
      }

      // Cycle complete -> clear active and continue loop.
      activeIssue = null;
      break;
    }

    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
