const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // API 프록시 설정 - /api로 시작하는 모든 요청을 백엔드로 전달
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8000',
      changeOrigin: true,
      logLevel: 'warn', // Changed from 'debug' to reduce console noise
    })
  );
};