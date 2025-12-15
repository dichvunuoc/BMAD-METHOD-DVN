const chalk = require('chalk');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runCapture(cwd, cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (err += String(d)));
    child.on('exit', (code) => resolve({ code: code ?? 1, out, err }));
  });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractIssueId(stdoutText) {
  const json = tryParseJson(stdoutText.trim());
  if (json && typeof json === 'object') {
    if (typeof json.id === 'string' || typeof json.id === 'number') return String(json.id);
    if (typeof json.issue_id === 'string' || typeof json.issue_id === 'number') return String(json.issue_id);
    if (typeof json.key === 'string' || typeof json.key === 'number') return String(json.key);
  }

  // Best-effort regex fallback
  const m1 = stdoutText.match(/"id"\s*:\s*"?([a-zA-Z0-9_-]+)"?/);
  if (m1) return m1[1];
  const m2 = stdoutText.match(/\bIssue\s+([a-zA-Z0-9_-]+)\b/);
  if (m2) return m2[1];
  return null;
}

function labelsForMode(mode) {
  switch (mode) {
    case 'needs-spec': {
      return ['bmad-story', 'needs-spec'];
    }
    case 'needs-validation': {
      return ['bmad-story', 'ready-for-dev', 'needs-validation'];
    }
    case 'spec-validated': {
      return ['bmad-story', 'ready-for-dev', 'spec-validated'];
    }
    case 'needs-fix': {
      return ['bmad-story', 'needs-fix'];
    }
    case 'needs-review': {
      return ['bmad-story', 'needs-review'];
    }
    default: {
      return null;
    }
  }
}

module.exports = {
  command: 'beads-seed-story',
  description: 'Beads-first: create (or label) a BMAD story issue as the kickoff for the 4-agent loop',
  options: [
    ['-d, --directory <path>', 'Project directory (repo root)', '.'],
    ['--title <text>', 'Issue title (required unless --issue-id is provided)'],
    ['--issue-id <id>', 'Existing issue id to label instead of creating a new one'],
    ['--mode <mode>', 'Start mode: needs-spec | needs-validation | spec-validated | needs-fix | needs-review', 'needs-spec'],
  ],
  action: async (options) => {
    const projectRoot = path.resolve(options.directory);
    const mode = String(options.mode || 'needs-spec');
    const labels = labelsForMode(mode);
    if (!labels) {
      console.log(chalk.red(`Invalid --mode "${mode}".`));
      process.exit(1);
    }

    // Ensure bd is usable
    const init = await runCapture(projectRoot, 'bd', ['init']);
    if (init.code !== 0) {
      console.log(chalk.red('bd init failed. Make sure Beads (bd) is installed and available on PATH.'));
      process.exit(1);
    }

    let issueId = options.issueId ? String(options.issueId) : null;

    if (!issueId) {
      const title = options.title ? String(options.title) : '';
      if (!title) {
        console.log(chalk.red('Missing --title (or provide --issue-id to label an existing issue).'));
        process.exit(1);
      }

      // Best-effort: try JSON output first.
      const created = await runCapture(projectRoot, 'bd', ['create', title, '--json']);
      issueId = extractIssueId(created.out);

      if (created.code !== 0 || !issueId) {
        console.log(chalk.yellow('Could not create issue with `bd create ... --json` (Beads CLI may differ).'));
        console.log(chalk.dim('Stdout:\n' + created.out));
        console.log(chalk.dim('Stderr:\n' + created.err));
        console.log(chalk.cyan('\nWorkaround: create the issue manually, then rerun with --issue-id.\n'));
        process.exit(1);
      }
    }

    for (const label of labels) {
      const res = await runCapture(projectRoot, 'bd', ['label', 'add', issueId, label]);
      if (res.code !== 0) {
        console.log(chalk.red(`Failed to add label "${label}" to issue ${issueId}.`));
        console.log(chalk.dim(res.err || res.out));
        process.exit(1);
      }
    }

    console.log(chalk.green(`✓ Seeded issue ${issueId}`));
    console.log(chalk.dim(`  labels: ${labels.join(', ')}`));
    console.log(chalk.dim(`  next: run 4-agent loop (sm1 dispatcher will pick this automatically)`));
    process.exit(0);
  },
};
