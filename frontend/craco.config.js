const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

module.exports = {
  // Webpack configuration
  webpack: {
    configure: (webpackConfig) => {
      // Set public path for proper routing
      webpackConfig.output.publicPath = '/';

      // three-mesh-bvh's WebGPU code (under the 3D view's ray tracer) star-exports
      // `closestPointToTriangle` from two of its files. In an ES module package
      // webpack fails the whole build on that; nothing takes the name through
      // the star export (its one user imports it from tsl/fns.js directly), so
      // the check is off for that package alone.
      webpackConfig.module.rules.push({
        test: /[\\/]node_modules[\\/]three-mesh-bvh[\\/]/,
        parser: { reexportExportsPresence: false },
      });

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
              // Only the cabinet sketch's 3D view uses three.js, and it is
              // lazy-loaded; kept out of `vendor`, it downloads with that view.
              three: {
                test: /[\\/]node_modules[\\/]three[\\/]/,
                name: 'vendor-three',
                priority: 20,
              },
              // The 3D view's ray tracer, fetched only when it is switched on:
              // the tracer and three's WebGPU build, which nothing else uses.
              pathtracer: {
                test: /[\\/]node_modules[\\/](three-gpu-pathtracer[\\/]|three-mesh-bvh[\\/]|three[\\/]build[\\/]three\.(webgpu|tsl)\.js)/,
                name: 'vendor-pathtracer',
                priority: 30,
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