import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
// Source-tree usage: `import inspector from 'ide-byebye/webpack'` in real projects.
import inspector from '../../dist/adapters/webpack.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'development',
  context: dir,
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
    // Stamps data-insp-path + injects bootstrap. Antigravity agents are on so this React demo shows them.
    inspector({
      agents: {
        antigravityIde: true,
        antigravity: true,
      },
    }),
  ],
  devServer: {
    // webpack-dev-server 5's default host can be [::1] only, which refuses 127.0.0.1.
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5400,
    hot: true,
    open: false,
  },
};
