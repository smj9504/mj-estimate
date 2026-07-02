const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  // Webpack configuration
  webpack: {
    configure: (webpackConfig) => {
      // Set public path for proper routing
      webpackConfig.output.publicPath = '/';

      if (!isProd) {
        // Dev: use native file watchers (faster than polling)
        webpackConfig.watchOptions = {
          aggregateTimeout: 600,
          ignored: /node_modules/,
        };

        // Remove ForkTsCheckerWebpackPlugin — IDE handles type checking
        // This is the biggest bottleneck for dev server startup
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (plugin) => plugin.constructor.name !== 'ForkTsCheckerWebpackPlugin'
        );
      }

      // Only apply chunk splitting in production builds
      if (isProd) {
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            cacheGroups: {
              antd: {
                test: /[\\/]node_modules[\\/](antd|@ant-design)[\\/]/,
                name: 'vendor-antd',
                priority: 20,
              },
              konva: {
                test: /[\\/]node_modules[\\/](konva|react-konva)[\\/]/,
                name: 'vendor-konva',
                priority: 20,
              },
              recharts: {
                test: /[\\/]node_modules[\\/]recharts[\\/]/,
                name: 'vendor-recharts',
                priority: 20,
              },
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendor',
                priority: 10,
              },
            },
          },
        };
      }

      return webpackConfig;
    },
  },
  // Dev server configuration
  devServer: {
    port: 3000,
    hot: true,
    allowedHosts: 'all',
    historyApiFallback: {
      index: '/index.html',
      disableDotRule: true,
    },
    setupMiddlewares: (middlewares, devServer) => {
      // This replaces onBeforeSetupMiddleware and onAfterSetupMiddleware
      return middlewares;
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        logLevel: 'debug',
        timeout: 300000, // 5 minutes timeout for PDF generation
        proxyTimeout: 300000, // 5 minutes proxy timeout
        onProxyReq: (proxyReq, req, res) => {
          console.log('Proxying:', req.method, req.url, '->', 'http://localhost:8000' + req.url);
        },
        onError: (err, req, res) => {
          console.error('Proxy error:', err);
        }
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
};