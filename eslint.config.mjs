import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

/**
 * Reglas de lint.
 *
 * Se parte de la configuración de los micro-* (mismo orden de imports, mismo
 * Prettier embebido) con UNA desviación deliberada: aquí `no-explicit-any` es
 * error, no `off`. La razón es que este API comparte producto con el frontend
 * `tienda-ropa`, cuyo CLAUDE.md prohíbe `any` sin excepciones; tener dos
 * criterios distintos a cada lado de la misma frontera de datos es la forma
 * más fácil de que un tipo mal narrowed cruce sin que nadie lo note.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'],
  },
  {
    files: ['**/*.ts', '**/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      'prettier/prettier': [
        'warn',
        {
          printWidth: 100,
          trailingComma: 'all',
          tabWidth: 2,
          semi: true,
          singleQuote: true,
          bracketSpacing: true,
          arrowParens: 'always',
          endOfLine: 'auto',
        },
      ],

      // Ver la nota de arriba: la frontera con el frontend exige el mismo rigor
      // a ambos lados.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_.*?$',
        },
      ],

      // `console.log` deja rastro de datos de clientas en los logs del hosting.
      // El logger de Nest sí sabe redactar y correlacionar por request.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      'import/order': [
        'warn',
        {
          groups: [
            'type',
            'builtin',
            'object',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          pathGroups: [
            { pattern: '@shared/**', group: 'internal', position: 'before' },
            { pattern: '@modules/**', group: 'internal', position: 'before' },
            { pattern: '@db/**', group: 'internal', position: 'before' },
          ],
          'newlines-between': 'always',
        },
      ],

      'padding-line-between-statements': [
        'warn',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      ],
    },
  },
];
