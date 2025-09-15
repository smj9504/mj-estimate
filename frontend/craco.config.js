const path = require('path');

module.exports = {
  // Webpack configuration
  webpack: {
    configure: (webpackConfig) => {
      // Set public path for proper routing
      webpackConfig.output.publicPath = '/';
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
        onProxyReq: (proxyReq, req, res) => {
          console.log('Proxying:', req.method, req.url, '->', 'http://localhost:8000' + req.url);
        },
        onError: (err, req, res) => {
          console.error('Proxy error:', err);
        }
      }
    }
  },
};