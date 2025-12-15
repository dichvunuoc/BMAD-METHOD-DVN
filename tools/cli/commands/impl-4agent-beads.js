const chalk = require('chalk');
const path = require('node:path');
const { spawn } = require('node:child_process');

function spawnDaemon(scriptPath, env) {
  const child = spawn(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return child;
}

module.exports = {
  command: 'impl-4agent-beads',
  description: 'Run Beads-first 4-agent implementation loop via MCP Agent Mail (SM1/SM2/DEV1/DEV2)',
  options: [
    ['-d, --directory <path>', 'Project directory (repo root)', '.'],
    ['--mcp-url <url>', 'MCP Agent Mail URL (default: http://127.0.0.1:8765/mcp/)', 'http://127.0.0.1:8765/mcp/'],
    ['--token-env <name>', 'Env var name holding the Agent Mail bearer token', 'MCP_AGENT_MAIL_TOKEN'],
  ],
  action: async (options) => {
    const projectRoot = path.resolve(options.directory);
    const projectKey = projectRoot; // Agent Mail identity rule: absolute working dir

    // Agent Mail requires adjective+noun names. Defaults are stable & memorable.
    const sm1Name = process.env.BMAD_SM1_NAME || 'BlueLake';
    const sm2Name = process.env.BMAD_SM2_NAME || 'GreenStone';
    const dev1Name = process.env.BMAD_DEV1_NAME || 'RedFox';
    const dev2Name = process.env.BMAD_DEV2_NAME || 'PurpleBear';

    // Runner configuration (CLI-agnostic) — you must provide commands for Claude/Cursor.
    const claudeCmd = process.env.BMAD_CLAUDE_CMD;
    const claudeArgs = process.env.BMAD_CLAUDE_ARGS; // JSON array, supports {PROMPT_FILE}
    const cursorCmd = process.env.BMAD_CURSOR_CMD;
    const cursorArgs = process.env.BMAD_CURSOR_ARGS; // JSON array, supports {PROMPT_FILE}

    if (!claudeCmd || !claudeArgs || !cursorCmd || !cursorArgs) {
      console.log(chalk.red('\nMissing runner env. Set these before running:\n'));
      console.log(chalk.cyan('  export BMAD_CLAUDE_CMD=bash'));
      console.log(
        chalk.cyan(
          String.raw`  export BMAD_CLAUDE_ARGS='["-lc","claude -p \"$(cat {PROMPT_FILE})\""]'   # replace with your Claude Code CLI invocation`,
        ),
      );
      console.log(chalk.cyan('  export BMAD_CURSOR_CMD=bash'));
      console.log(
        chalk.cyan(
          String.raw`  export BMAD_CURSOR_ARGS='["-lc","cursor -p \"$(cat {PROMPT_FILE})\""]' # replace with your Cursor CLI invocation`,
        ),
      );
      console.log(chalk.dim('\nBMAD_RUNNER_* is per-daemon; this command maps SM->Claude and DEV->Cursor by default.\n'));
      process.exit(1);
    }

    // These daemon scripts live inside the BMAD package (not the target project).
    const implDir = path.resolve(__dirname, '..', 'impl', 'impl-4agent-beads');
    const sm1Script = path.join(implDir, 'sm1-daemon.js');
    const workerScript = path.join(implDir, 'worker-daemon.js');

    console.log(chalk.green('\n▶ Starting BMAD 4-agent Beads-first loop (Agent Mail)...'));
    console.log(chalk.dim(`Project: ${projectRoot}`));
    console.log(chalk.dim(`Agent Mail: ${options.mcpUrl}`));
    console.log(chalk.dim(`Agents: sm1=${sm1Name}, sm2=${sm2Name}, dev1=${dev1Name}, dev2=${dev2Name}\n`));

    const commonEnv = {
      BMAD_PROJECT_ROOT: projectRoot,
      BMAD_PROJECT_KEY: projectKey,
      BMAD_MCP_AGENT_MAIL_URL: options.mcpUrl,
      BMAD_MCP_AGENT_MAIL_TOKEN_ENV: options.tokenEnv,
      BMAD_POLL_MS: process.env.BMAD_POLL_MS || '2000',
    };

    // SM1 (Claude runner) — also dispatches jobs.
    const sm1 = spawnDaemon(sm1Script, {
      ...commonEnv,
      BMAD_AGENT_MAIL_NAME: sm1Name,
      BMAD_WORKER_PROGRAM: 'bmad-sm1',
      BMAD_WORKER_TASK_DESCRIPTION: 'BMAD SM1 create-story-beads (dispatcher)',
      BMAD_SM2_AGENT_MAIL_NAME: sm2Name,
      BMAD_DEV1_AGENT_MAIL_NAME: dev1Name,
      BMAD_DEV2_AGENT_MAIL_NAME: dev2Name,
      BMAD_RUNNER_CMD: claudeCmd,
      BMAD_RUNNER_ARGS: claudeArgs,
    });

    // SM2 (Claude runner)
    const sm2 = spawnDaemon(workerScript, {
      ...commonEnv,
      BMAD_AGENT_MAIL_NAME: sm2Name,
      BMAD_WORKER_ROLE: 'sm2',
      BMAD_WORKER_PROGRAM: 'bmad-sm2',
      BMAD_WORKER_TASK_DESCRIPTION: 'BMAD SM2 validate-create-story-beads',
      BMAD_RUNNER_CMD: claudeCmd,
      BMAD_RUNNER_ARGS: claudeArgs,
    });

    // DEV1 (Cursor runner)
    const dev1 = spawnDaemon(workerScript, {
      ...commonEnv,
      BMAD_AGENT_MAIL_NAME: dev1Name,
      BMAD_WORKER_ROLE: 'dev1',
      BMAD_WORKER_PROGRAM: 'bmad-dev1',
      BMAD_WORKER_TASK_DESCRIPTION: 'BMAD DEV1 dev-story-beads',
      BMAD_RUNNER_CMD: cursorCmd,
      BMAD_RUNNER_ARGS: cursorArgs,
    });

    // DEV2 (Cursor runner)
    const dev2 = spawnDaemon(workerScript, {
      ...commonEnv,
      BMAD_AGENT_MAIL_NAME: dev2Name,
      BMAD_WORKER_ROLE: 'dev2',
      BMAD_WORKER_PROGRAM: 'bmad-dev2',
      BMAD_WORKER_TASK_DESCRIPTION: 'BMAD DEV2 code-review-beads',
      BMAD_RUNNER_CMD: cursorCmd,
      BMAD_RUNNER_ARGS: cursorArgs,
    });

    const children = [sm1, sm2, dev1, dev2];
    const shutdown = () => {
      for (const c of children) {
        try {
          c.kill('SIGINT');
        } catch {
          // ignore
        }
      }
    };

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nStopping daemons...'));
      shutdown();
      process.exit(0);
    });
  },
};
