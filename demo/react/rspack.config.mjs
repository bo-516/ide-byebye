import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
// Source-tree usage: `import inspector from 'ide-byebye/rspack'` in real projects.
import inspector from '../../dist/adapters/rspack.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

/** React demo under rspack — same app as the Vite/webpack variants. */
export default {
  mode: 'development',
  context: dir,
  entry: './src/main.jsx',
  output: { path: path.resolve(dir, 'dist-rspack'), filename: 'bundle.js' },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'ecmascript', jsx: true },
              transform: { react: { runtime: 'automatic' } },
            },
          },
        },
        type: 'javascript/auto',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
        type: 'javascript/auto',
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({ template: './webpack.html', title: 'ai-inspector · demo (rspack)' }),
    inspector(),
  ],
  devServer: {
    port: Number(process.env.PORT) || 5500,
    hot: true,
    open: false,
  },
};
