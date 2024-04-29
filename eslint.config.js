// @ts-check

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
  eslint.configs.recommended,
  //   ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.recommendedTypeChecked,
  // ...stylistic.configs.customize({
  //   // the following options are the default values
  //   indent: 2,
  //   quotes: 'single',
  //   semi: false,
  //   jsx: true,
  //   // ...
  // }),
  stylistic.configs['recommended-flat'],
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      'no-extra-boolean-cast': 'off',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false
        }
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' }
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      // '@stylistic/quotes': ['error', 'double']
    },
    plugins: {
      '@stylistic': stylistic
    }
  }
)
