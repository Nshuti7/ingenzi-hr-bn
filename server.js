const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger Documentation
// Update Swagger servers to match current port
const swaggerSpecWithPort = {
  ...swaggerSpec,
  servers: [
    {
      url: `http://localhost:${PORT}`,
      description: 'Current server'
    },
    {
      url: 'https://api.ingenzi.com',
      description: 'Production server'
    }
  ]
};

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecWithPort, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'INGENZI HRMS API Documentation'
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/recruitment', require('./routes/recruitment'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Health check
/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: INGENZI HRMS API is running
 */
app.get('/api/health', (req, res) => {
  // Quick health check - no database calls
  res.json({ 
    status: 'ok', 
    message: 'INGENZI HRMS API is running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`INGENZI HRMS API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`API Documentation: http://localhost:${PORT}/api-docs`);
});

module.exports = app;

