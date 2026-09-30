import { resolve } from 'node:path'

export function createResumeOpenPlan({
  args = [],
  cwd = process.cwd(),
  origin = 'http://127.0.0.1:4173',
  defaultResume = 'agent-dev.json',
} = {}) {
  const dryRun = args.includes('--dry-run')
  const positionalArgs = args.filter((argument) => argument !== '--dry-run')
  if (positionalArgs.length > 1) {
    throw new Error('用法：npm run resume:open -- [resume.json]')
  }

  return {
    dryRun,
    resumePath: resolve(cwd, positionalArgs[0] || defaultResume),
    pageUrl: new URL('/', origin).href,
    importMethod: 'file-input',
  }
}
