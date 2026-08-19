export function Flow({
  trigger,
  branches,
}: {
  trigger: string;
  branches: { title: string; steps: string[] }[];
}) {
  return (
    <figure className="m-0 mt-6 rounded-xl border border-rule bg-panel p-5">
      <div className="inline-flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-wash px-3 py-1.5">
        <span className="size-1.5 rounded-full bg-accent" />
        <span className="font-mono text-[12px] text-accent">{trigger}</span>
      </div>

      <div className="ml-[13px] flex flex-col gap-5 border-l border-rule pt-5 pl-7">
        {branches.map((branch) => (
          <div key={branch.title} className="relative">
            <span className="absolute top-[10px] -left-7 h-px w-7 bg-rule" />
            <span className="absolute top-[7px] -left-[31px] size-[7px] rounded-full bg-accent ring-[3px] ring-panel" />
            <p className="m-0 text-[14px] font-medium text-ink">{branch.title}</p>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
              {branch.steps.map((step) => (
                <li
                  key={step}
                  className="relative pl-4 font-mono text-[12px] leading-[1.6] text-ink-2 before:absolute before:top-[9px] before:left-0 before:h-px before:w-2 before:bg-cold/50"
                >
                  {step}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  );
}
