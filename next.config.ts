import type { NextConfig } from 'next';

const onGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: onGitHubPages ? '/IRT' : '',
  assetPrefix: onGitHubPages ? '/IRT/' : '',
};

export default nextConfig;
