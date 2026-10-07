import type { ComponentType } from 'react';
import Benchmarks from './benchmarks.mdx';
import Cli from './cli.mdx';
import CodeGraph from './code-graph.mdx';
import Databases from './databases.mdx';
import HowItWorks from './how-it-works.mdx';
import Installation from './installation.mdx';
import Introduction from './introduction.mdx';
import McpTools from './mcp-tools.mdx';
import Privacy from './privacy.mdx';
import QuickStart from './quick-start.mdx';
import Skills from './skills.mdx';
import Troubleshooting from './troubleshooting.mdx';

export const BODIES: Record<string, ComponentType> = {
  '': Introduction,
  installation: Installation,
  'quick-start': QuickStart,
  'how-it-works': HowItWorks,
  'code-graph': CodeGraph,
  databases: Databases,
  skills: Skills,
  privacy: Privacy,
  cli: Cli,
  'mcp-tools': McpTools,
  troubleshooting: Troubleshooting,
  benchmarks: Benchmarks,
};
