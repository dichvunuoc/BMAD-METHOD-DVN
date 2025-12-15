const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { McpHttpClient } = require('./mcp-http-client');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {string} projectRoot
 * @param {string[]} args
 */
function runCommand(projectRoot, args) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * This is intentionally CLI-agnostic: configure runner command via env.
 *
 * Required env:
 * - BMAD_RUNNER_CMD: e.g. "claude" or "cursor" (must be on PATH)
 * - BMAD_RUNNER_ARGS: JSON array, supports "{PROMPT_FILE}" placeholder
 */
async function runAgentJob({ projectRoot, prompt, logsDir }) {
  const cmd = process.env.BMAD_RUNNER_CMD;
  const rawArgs = process.env.BMAD_RUNNER_ARGS;
  if (!cmd || !rawArgs) {
    throw new Error('Missing runner configuration. Set BMAD_RUNNER_CMD and BMAD_RUNNER_ARGS.');
  }

  let args = safeJsonParse(rawArgs);
  if (!Array.isArray(args)) {
    throw new TypeError('BMAD_RUNNER_ARGS must be a JSON array (e.g. ["-p","{PROMPT_FILE}"]).');
  }

  ensureDir(logsDir);
  const promptFile = path.join(logsDir, `prompt-${Date.now()}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf8');

  args = args.map((a) => (typeof a === 'string' ? a.replaceAll('{PROMPT_FILE}', promptFile) : a));
  const exitCode = await runCommand(projectRoot, [cmd, ...args]);
  return { exitCode, promptFile };
}

/**
 * @param {string} bodyMd
 * @returns {{job?: any}}
 */
function parseJobFromBody(bodyMd) {
  // Convention: body contains a single JSON object fenced with ```json ... ```
  const m = bodyMd.match(/```json\s*([\s\S]*?)\s*```/);
  if (!m) return {};
  const job = safeJsonParse(m[1]);
  if (!job || typeof job !== 'object') return {};
  return { job };
}

async function main() {
  const projectRoot = process.env.BMAD_PROJECT_ROOT || process.cwd();
  const projectKey = process.env.BMAD_PROJECT_KEY || projectRoot;

  const mcpUrl = process.env.BMAD_MCP_AGENT_MAIL_URL || 'http://127.0.0.1:8765/mcp/';
  const tokenEnv = process.env.BMAD_MCP_AGENT_MAIL_TOKEN_ENV || 'MCP_AGENT_MAIL_TOKEN';
  const token = process.env[tokenEnv];

  const agentName = process.env.BMAD_AGENT_MAIL_NAME;
  const role = process.env.BMAD_WORKER_ROLE;
  const program = process.env.BMAD_WORKER_PROGRAM || 'bmad-worker';
  const model = process.env.BMAD_WORKER_MODEL || 'unknown';
  const taskDescription = process.env.BMAD_WORKER_TASK_DESCRIPTION || `BMAD ${role}`;

  if (!agentName || !role) {
    throw new Error('Missing BMAD_AGENT_MAIL_NAME or BMAD_WORKER_ROLE.');
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const mcp = new McpHttpClient({ url: mcpUrl, headers });

  // Ensure project + register this daemon identity in Agent Mail (idempotent).
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

  const pollMs = Number.parseInt(process.env.BMAD_POLL_MS || '2000', 10);
  const logsDir = path.join(projectRoot, '.bmad', 'impl-4agent-beads', 'logs', role);
  ensureDir(logsDir);

  let sinceTs = null;
  while (true) {
    /** @type {any[]} */
    const msgs = await mcp.callTool('fetch_inbox', {
      project_key: projectKey,
      agent_name: agentName,
      limit: 20,
      include_bodies: true,
      ...(sinceTs ? { since_ts: sinceTs } : {}),
    });

    // Update sinceTs with newest created_ts we saw (best-effort).
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
      if (!msg || typeof msg.subject !== 'string' || typeof msg.body_md !== 'string') continue;
      if (!msg.subject.startsWith('BMAD JOB:')) continue;
      const { job } = parseJobFromBody(msg.body_md);
      if (!job) continue;
      if (job.to_role !== role) continue;
      if (job.to_agent_name && job.to_agent_name !== agentName) continue;

      // Ack ASAP to avoid duplicate handling.
      if (msg.id) {
        try {
          await mcp.callTool('acknowledge_message', { project_key: projectKey, agent_name: agentName, message_id: msg.id });
        } catch {
          // best-effort
        }
      }

      const issueId = job.issue_id;
      const step = job.step;
      const nextStep = job.next_step;
      const nextRole = job.next_role;

      const prompt = [
        `You are running in automation mode. Do NOT ask the human anything.`,
        `Project root: ${projectRoot}`,
        `Beads issue_id: ${issueId}`,
        ``,
        `Your task: run BMAD workflow step: ${step} (Beads-first).`,
        `- Use bd CLI only; never edit .beads/* directly.`,
        `- Prefer deterministic "no-ask" behavior; auto-fix where the workflow allows.`,
        `- After completing the workflow, output a short plain-text summary and then exit.`,
        ``,
        `Workflow mapping (Beads-first):`,
        `- create-story-beads: ${projectRoot}/_bmad/bmm/workflows/4-implementation/create-story-beads/workflow.yaml`,
        `- validate-create-story-beads: ${projectRoot}/_bmad/bmm/workflows/4-implementation/validate-create-story-beads/workflow.yaml`,
        `- dev-story-beads: ${projectRoot}/_bmad/bmm/workflows/4-implementation/dev-story-beads/workflow.yaml`,
        `- code-review-beads: ${projectRoot}/_bmad/bmm/workflows/4-implementation/code-review-beads/workflow.yaml`,
        ``,
        `Run the correct one for step="${step}". If the workflow normally "selects an issue", force it to use issue_id ${issueId}.`,
      ].join('\n');

      let exitCode = 1;
      let promptFile = null;
      try {
        const result = await runAgentJob({ projectRoot, prompt, logsDir });
        exitCode = result.exitCode;
        promptFile = result.promptFile;
      } catch {
        exitCode = 1;
      }

      // Hand off to next role via Agent Mail (daemon-driven, not LLM-driven).
      if (nextRole && nextStep && job.next_agent_name) {
        const nextJob = {
          issue_id: issueId,
          step: nextStep,
          thread_id: job.thread_id || issueId,
          to_role: nextRole,
          to_agent_name: job.next_agent_name,
          next_step: job.next_next_step || null,
          next_role: job.next_next_role || null,
          next_agent_name: job.next_next_agent_name || null,
          done_to_role: job.done_to_role || null,
          done_to_agent_name: job.done_to_agent_name || null,
        };

        await mcp.callTool('send_message', {
          project_key: projectKey,
          sender_name: agentName,
          to: [job.next_agent_name],
          subject: `BMAD JOB: ${nextStep} ${issueId}`,
          body_md: `\`\`\`json\n${JSON.stringify(nextJob, null, 2)}\n\`\`\`\n`,
          thread_id: job.thread_id || issueId,
          auto_contact_if_blocked: true,
        });
      } else if (job.done_to_agent_name) {
        await mcp.callTool('send_message', {
          project_key: projectKey,
          sender_name: agentName,
          to: [job.done_to_agent_name],
          subject: `BMAD DONE: ${step} ${issueId}`,
          body_md: [
            `BMAD automation done.`,
            ``,
            `- step: ${step}`,
            `- issue_id: ${issueId}`,
            `- from_role: ${role}`,
            `- runner_exit_code: ${exitCode}`,
            promptFile ? `- prompt_file: ${promptFile}` : `- prompt_file: (none)`,
          ].join('\n'),
          thread_id: job.thread_id || issueId,
          auto_contact_if_blocked: true,
        });
      }
    }

    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
