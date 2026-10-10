import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config({ignores:['dist/**','node_modules/**','.wrangler/**','test-results/**','playwright-report/**','browser-api-results/**','playwright-api-report/**']},js.configs.recommended,...ts.configs.recommended,{languageOptions:{globals:{...globals.browser,...globals.node}},rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});
