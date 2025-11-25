const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult, query } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/employees:
 *   get:
 *     summary: Get all employees (HR Manager and Admin only)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: integer
 *         description: Filter by department ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, terminated]
 *         description: Filter by status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, or employee ID
 *     responses:
 *       200:
 *         description: List of employees
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 employees:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Employee'
 *       403:
 *         description: Insufficient permissions
 */
router.get('/', authorize('hr_manager', 'system_admin'), async (req, res) => {
  try {
    const { departmentId, status, search } = req.query;

    const where = {};
    if (departmentId) where.departmentId = parseInt(departmentId);
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { employeeId: { contains: search } }
      ];
    }

    const employees = await prisma.employee.findMany({
      where,
      include: {
        department: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ employees });
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     summary: Get employee by ID
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Employee ID
 *     responses:
 *       200:
 *         description: Employee details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 employee:
 *                   $ref: '#/components/schemas/Employee'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Employee not found
 */
router.get('/:id', async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);
    const userRole = req.user.role;

    // Employees can only view their own data
    if (userRole === 'employee') {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (!user.employee || user.employee.id !== employeeId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        department: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true
          }
        }
      }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ employee });
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

/**
 * @swagger
 * /api/employees:
 *   post:
 *     summary: Create new employee (HR Manager and Admin only)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateEmployeeRequest'
 *     responses:
 *       201:
 *         description: Employee created successfully
 *       400:
 *         description: Validation error or email already exists
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', [
  authorize('hr_manager', 'system_admin'),
  body('firstName').notEmpty(),
  body('lastName').notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('departmentId').isInt(),
  body('position').notEmpty(),
  body('salary').isFloat({ min: 0 }),
  body('hireDate').isISO8601(),
  body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['employee', 'hr_manager', 'system_admin'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      departmentId,
      position,
      salary,
      hireDate,
      address,
      status = 'active',
      password,
      role = 'employee'
    } = req.body;

    // Check if email exists in employees
    const existingEmployee = await prisma.employee.findUnique({
      where: { email }
    });

    if (existingEmployee) {
      return res.status(400).json({ error: 'Employee with this email already exists' });
    }

    // Check if email exists in users
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Generate employee ID if not provided
    const empId = employeeId || `EMP${Date.now()}`;

    // Create employee and optionally create user account
    let user = null;
    if (password) {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Create user account
      user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name: `${firstName} ${lastName}`,
          role: role,
          employeeId: empId
        }
      });
    }

    const employee = await prisma.employee.create({
      data: {
        employeeId: empId,
        firstName,
        lastName,
        email,
        phone,
        departmentId: parseInt(departmentId),
        position,
        salary: parseFloat(salary),
        hireDate: new Date(hireDate),
        address,
        status,
        userId: user ? user.id : null
      },
      include: {
        department: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true
          }
        }
      }
    });

    res.status(201).json({ employee });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     summary: Update employee (HR Manager and Admin only)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               departmentId:
 *                 type: integer
 *               position:
 *                 type: string
 *               salary:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [active, inactive, terminated]
 *     responses:
 *       200:
 *         description: Employee updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Employee not found
 */
router.put('/:id', [
  authorize('hr_manager', 'system_admin'),
  body('firstName').optional().notEmpty(),
  body('lastName').optional().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('departmentId').optional().isInt(),
  body('position').optional().notEmpty(),
  body('salary').optional().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const employeeId = parseInt(req.params.id);
    const updateData = { ...req.body };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Convert date strings to Date objects
    if (updateData.hireDate) {
      updateData.hireDate = new Date(updateData.hireDate);
    }

    // Convert numeric fields
    if (updateData.departmentId) {
      updateData.departmentId = parseInt(updateData.departmentId);
    }
    if (updateData.salary) {
      updateData.salary = parseFloat(updateData.salary);
    }

    // Allow updating userId to link employee to user
    if (updateData.userId !== undefined) {
      updateData.userId = parseInt(updateData.userId) || null;
    }

    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: updateData,
      include: {
        department: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true
          }
        }
      }
    });

    res.json({ employee });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     summary: Delete employee (Admin only)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Employee deleted successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Employee not found
 */
router.delete('/:id', authorize('system_admin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.params.id);

    await prisma.employee.delete({
      where: { id: employeeId }
    });

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Employee not found' });
    }
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

module.exports = router;

