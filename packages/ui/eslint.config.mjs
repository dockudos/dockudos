import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // shadcn generates self-imports through the `@dockudos/ui/*` alias
    // (see components.json), so those must stay allowed.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^@dockudos/ui/.*',
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
          ],
          depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }],
        },
      ],
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
