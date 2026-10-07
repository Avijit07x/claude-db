import { gatherCatchup } from '../../catchup/gather.js';
import { renderCatchup } from '../../catchup/render.js';
import { createContext } from '../../context.js';
import { resolveProject } from '../../util/project.js';

export async function cmdCatchup(): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();
  try {
    console.log(renderCatchup(await gatherCatchup(ctx, project)));
  } finally {
    await ctx.close();
  }
}
