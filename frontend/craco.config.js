const path = require('path');

module.exports = {
  // Webpack configuration
  webpack: {
    configure: (webpackConfig) => {
      // Set public path for proper routing
      webpackConfig.output.publicPath = '/';
      // Enable polling on Windows where native file watchers miss external editor changes
      webpackConfig.watchOptions = {
        poll: 500,
        aggregateTimeout: 300,
      };
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