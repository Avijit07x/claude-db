export function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text',
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function usesTools(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_use',
    )
  );
}

export function extractToolCalls(content: unknown): { file?: string; command?: string }[] {
  if (!Array.isArray(content)) return [];

  const calls: { file?: string; command?: string }[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const typed = block as { type?: string; name?: string; input?: Record<string, unknown> };
    if (typed.type !== 'tool_use') continue;

    const input = typed.input ?? {};
    if (typed.name === 'Write' || typed.name === 'Edit' || typed.name === 'MultiEdit') {
      const file = input['file_path'];
      if (typeof file === 'string') calls.push({ file });
    } else if (typed.name === 'Bash') {
      const command = input['command'];
      if (typeof command === 'string') calls.push({ command });
    }
  }
  return calls;
}
