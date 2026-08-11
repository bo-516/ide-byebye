import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VueLoaderPlugin } from 'vue-loader';
import HtmlWebpackPlugin from 'html-webpack-plugin';
// Source-tree usage: `import inspector from 'ide-byebye/webpack'` in real projects.
import inspector from '../../dist/adapters/webpack.js';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'development',
  context: dir,
  entry: './src/main.js',
  output: { path: path.resolve(dir, 'dist'), filename: 'bundle.js' },
  resolve: {
    extensions: ['.js', '.vue'],
    // vue.esm-bundler is required for SFC runtime compilation features.
    alias: { vue: 'vue/dist/vue.esm-bundler.js' },
  },
  module: {
    rules: [
      { test: /\.vue$/, loader: 'vue-loader' },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            babelrc: false,
            configFile: false,
            presets: [['@babel/preset-env', { targets: 'defaults' }]],
          },
        },
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({ template: './webpack.html' }),
    inspector(),
  ],
  devServer: {
    port: Number(process.env.PORT) || 5700,
    hot: true,
    open: false,
  },
};
