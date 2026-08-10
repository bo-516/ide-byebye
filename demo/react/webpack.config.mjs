import path from 'node:path';
import { fileURLToPath } from 'node:url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
// Source-tree usage: `import inspector from 'ide-byebye/webpack'` in real projects.
import inspector from '../../webpack.js';

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
    // Zero-config: registers code-inspector + injects bootstrap into emitted HTML.
    inspector(),
  ],
  devServer: {
    port: Number(process.env.PORT) || 5400,
    hot: true,
    open: false,
  },
};
