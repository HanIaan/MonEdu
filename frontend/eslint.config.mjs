import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts', 'src/lib/api/schema.d.ts'],
  },
];

export default config;
