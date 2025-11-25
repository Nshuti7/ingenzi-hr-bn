const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { employee: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return user data (without password)
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        employeeId: user.employeeId
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * @swagger
 * /api/auth/bootstrap:
 *   post:
 *     summary: Create first admin user (No authentication required)
 *     description: |
 *       Use this endpoint to create the first system administrator.
 *       - This endpoint does NOT require authentication
 *       - Only works if no admin user exists yet
 *       - If an admin already exists, use /api/auth/register instead (requires admin login)
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@ingenzi.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 description: Will be hashed automatically
 *                 example: admin123
 *               name:
 *                 type: string
 *                 example: System Administrator
 *           examples:
 *             example1:
 *               summary: Create Admin Example
 *               value:
 *                 email: admin@ingenzi.com
 *                 password: admin123
 *                 name: System Administrator
 *     responses:
 *       201:
 *         description: Admin user created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Admin user created successfully
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     name:
 *                       type: string
 *                     role:
 *                       type: string
 *                       example: system_admin
 *       400:
 *         description: Admin already exists or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Database connection error
 */
router.post('/bootstrap', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').notEmpty()
], async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate input first (before any DB calls)
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    // Set timeout for database operations (10 seconds)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout - database may be slow or unreachable')), 10000);
    });

    // Optimize: Check both admin existence and email in parallel
    const [existingAdmin, existingUser] = await Promise.race([
      Promise.all([
        prisma.user.findFirst({
          where: { role: 'system_admin' },
          select: { id: true } // Only select id for faster query
        }),
        prisma.user.findUnique({
          where: { email },
          select: { id: true } // Only select id for faster query
        })
      ]),
      timeoutPromise
    ]);

    if (existingAdmin) {
      return res.status(400).json({ 
        error: 'Admin user already exists. Use /api/auth/register endpoint with admin authentication instead.' 
      });
    }

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password (this is fast, no timeout needed)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user with timeout
    const user = await Promise.race([
      prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role: 'system_admin'
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true
        }
      }),
      timeoutPromise
    ]);

    const duration = Date.now() - startTime;
    console.log(`Bootstrap completed in ${duration}ms`);

    res.status(201).json({
      message: 'Admin user created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`Bootstrap error after ${duration}ms:`, error.message);
    
    // Check if it's a timeout
    if (error.message.includes('timeout')) {
      return res.status(504).json({ 
        error: 'Request timeout - database operation took too long',
        hint: 'Please check your database connection and try again. If the problem persists, check MySQL server status.'
      });
    }
    
    // Check if it's a database connection error
    if (error.code === 'P1001' || error.message.includes('connect') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({ 
        error: 'Database connection error. Please check your database connection.',
        hint: 'Make sure MySQL is running and DATABASE_URL is correct in .env file'
      });
    }
    
    if (error.code === 'P2002') {
      return res.status(400).json({ 
        error: 'User with this email already exists' 
      });
    }

    res.status(500).json({ 
      error: 'Failed to create admin user',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register new user (Admin only)
 *     description: |
 *       Create a new user account. Only system administrators can use this endpoint.
 *       - Requires authentication (Bearer token from admin login)
 *       - Can create users with any role (employee, hr_manager, system_admin)
 *       - To create the FIRST admin, use /api/auth/bootstrap instead
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: newadmin@ingenzi.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 description: Will be hashed automatically
 *                 example: password123
 *               name:
 *                 type: string
 *                 example: New Administrator
 *               role:
 *                 type: string
 *                 enum: [employee, hr_manager, system_admin]
 *                 example: system_admin
 *                 description: User role - can be employee, hr_manager, or system_admin
 *               employeeId:
 *                 type: string
 *                 description: Optional - Can be linked to existing employee
 *                 example: EMP001
 *           examples:
 *             createAdmin:
 *               summary: Create Additional Admin
 *               value:
 *                 email: admin2@ingenzi.com
 *                 password: admin123
 *                 name: Second Administrator
 *                 role: system_admin
 *             createHR:
 *               summary: Create HR Manager
 *               value:
 *                 email: hr@ingenzi.com
 *                 password: hr123
 *                 name: HR Manager
 *                 role: hr_manager
 *             createEmployee:
 *               summary: Create Employee User
 *               value:
 *                 email: employee@ingenzi.com
 *                 password: emp123
 *                 name: John Doe
 *                 role: employee
 *                 employeeId: EMP001
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User created successfully
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Insufficient permissions - Only system administrators can register users
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/register', [
  authenticate,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').notEmpty(),
  body('role').isIn(['employee', 'hr_manager', 'system_admin'])
], async (req, res) => {
  try {
    // Only system admin can register users
    if (req.user.role !== 'system_admin') {
      return res.status(403).json({ error: 'Only system administrators can register users' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, role, employeeId } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        employeeId: employeeId || null
      }
    });

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * @swagger
 * /api/auth/check-admin:
 *   get:
 *     summary: Check if admin user exists
 *     description: |
 *       Check if any system administrator exists in the database.
 *       - Returns true if at least one admin exists
 *       - Returns false if no admin exists (use /api/auth/bootstrap to create first admin)
 *       - No authentication required
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Admin check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 adminExists:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Admin user exists. Use /api/auth/register to create additional admins.
 */
router.get('/check-admin', async (req, res) => {
  try {
    const adminExists = await prisma.user.findFirst({
      where: { role: 'system_admin' }
    });

    res.json({
      adminExists: !!adminExists,
      message: adminExists
        ? 'Admin user exists. Use /api/auth/register to create additional admins (requires admin authentication).'
        : 'No admin user exists. Use /api/auth/bootstrap to create the first admin.'
    });
  } catch (error) {
    console.error('Check admin error:', error);
    res.status(500).json({ error: 'Failed to check admin status' });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     description: |
 *       Get information about the currently authenticated user.
 *       - Requires authentication (Bearer token)
 *       - Returns user details including role and linked employee if applicable
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    // Remove password from response
    if (user) {
      delete user.password;
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

module.exports = router;

