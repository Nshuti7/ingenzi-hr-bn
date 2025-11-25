const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Get all departments
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of departments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departments:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Department'
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status) where.status = status;

    const departments = await prisma.department.findMany({
      where,
      include: {
        _count: {
          select: { employees: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({ departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * @swagger
 * /api/departments/{id}:
 *   get:
 *     summary: Get department by ID
 *     tags: [Departments]
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
 *         description: Department details
 *       404:
 *         description: Department not found
 */
router.get('/:id', async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);

    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        employees: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                role: true
              }
            }
          }
        },
        _count: {
          select: { employees: true }
        }
      }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({ department });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ error: 'Failed to fetch department' });
  }
});

/**
 * @swagger
 * /api/departments:
 *   post:
 *     summary: Create new department (HR Manager and Admin only)
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDepartmentRequest'
 *     responses:
 *       201:
 *         description: Department created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', [
  authorize('hr_manager', 'system_admin'),
  body('name').notEmpty(),
  body('description').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, status = 'active' } = req.body;

    const department = await prisma.department.create({
      data: {
        name,
        description,
        status
      }
    });

    res.status(201).json({ department });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

/**
 * @swagger
 * /api/departments/{id}:
 *   put:
 *     summary: Update department (HR Manager and Admin only)
 *     tags: [Departments]
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive]
 *     responses:
 *       200:
 *         description: Department updated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Department not found
 */
router.put('/:id', [
  authorize('hr_manager', 'system_admin'),
  body('name').optional().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const departmentId = parseInt(req.params.id);
    const updateData = { ...req.body };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    const department = await prisma.department.update({
      where: { id: departmentId },
      data: updateData
    });

    res.json({ department });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Department not found' });
    }
    console.error('Update department error:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

/**
 * @swagger
 * /api/departments/{id}:
 *   delete:
 *     summary: Delete department (Admin only)
 *     tags: [Departments]
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
 *         description: Department deleted successfully
 *       400:
 *         description: Department has employees
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Department not found
 */
router.delete('/:id', authorize('system_admin'), async (req, res) => {
  try {
    const departmentId = parseInt(req.params.id);

    // Check if department has employees
    const employeeCount = await prisma.employee.count({
      where: { departmentId }
    });

    if (employeeCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete department with ${employeeCount} employee(s). Please reassign employees first.` 
      });
    }

    await prisma.department.delete({
      where: { id: departmentId }
    });

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Department not found' });
    }
    console.error('Delete department error:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

module.exports = router;

