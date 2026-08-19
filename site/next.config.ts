import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import createMDX from '@next/mdx';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  pageExtensions: ['ts', 'tsx', 'mdx'],
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [['remark-gfm', {}]],
  },
});

export default withMDX(config);
