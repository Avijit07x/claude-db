import { gatherCatchup } from '../../catchup/gather.js';
import { renderCatchup } from '../../catchup/render.js';
import { createContext } from '../../context.js';
import { resolveProject } from '../../util/project.js';

export async function cmdCatchup(): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();
  try {
    const current = process.env['CLAUDE_CODE_SESSION_ID'] || undefined;
    console.log(renderCatchup(await gatherCatchup(ctx, project, current)));
  } finally {
    await ctx.close();
  }
}
