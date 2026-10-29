// Bundles the browser libraries into app/vendor: the official Anthropic SDK and SheetJS CE.
// Usage: node tools/build-vendor.mjs
import { build } from 'esbuild';

const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, legalComments: 'eof' };

await build({
  ...common,
  stdin: { contents: "export { default } from '@anthropic-ai/sdk';", resolveDir: '.', loader: 'js' },
  outfile: 'app/vendor/anthropic.js',
});
await build({ ...common, entryPoints: ['node_modules/xlsx/xlsx.mjs'], outfile: 'app/vendor/xlsx.mjs' });
console.log('vendor built');
