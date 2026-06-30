import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
// Source-tree usage: import the webpack adapter straight from the package root.
// In a real project this is: import inspector from 'ide-byebye/webpack'
import inspector from '../webpack.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'development',
  context: dir,
  // Same entry/source the Vite demo uses, so both bundlers build the identical app.
  entry: './src/main.jsx',
  output: { path: path.resolve(dir, 'dist'), filename: 'bundle.js' },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          // Inline + babelrc:false so this config never leaks into Vite's own @vitejs/plugin-react babel pass.
          options: {
            babelrc: false,
            configFile: false,
            presets: [
              ['@babel/preset-env', { targets: 'defaults' }],
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './webpack.html' }),
    // Zero-config: registers code-inspector (data-insp-path) internally and injects the inspector bootstrap into the
    // emitted HTML. No `bundler` to pass; ⌘/Ctrl-click on by default.
    inspector({
      defaultAgent: 'claude-app',
      agents: {
        claudeApp: true,
        codexApp: { enabled: true },
        cursorApp: { enabled: true, workspace: 'demo' },
      },
    }),
  ],
  devServer: {
    port: Number(process.env.PORT) || 5400,
    hot: true,
    open: false,
  },
};
