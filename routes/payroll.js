const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/payroll:
 *   get:
 *     summary: Get payroll records
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of payroll records
 */
router.get('/', async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    const userRole = req.user.role;

    const where = {};

    // Employees can only see their own payroll
    if (userRole === 'employee') {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (!user.employee) {
        return res.status(404).json({ error: 'Employee record not found' });
      }

      where.employeeId = user.employee.id;
    } else if (employeeId) {
      where.employeeId = parseInt(employeeId);
    }

    if (month) where.month = parseInt(month);
    if (year) where.year = parseInt(year);

    const payrolls = await prisma.payroll.findMany({
      where,
      include: {
        employee: {
          include: {
            department: true
          }
        }
      },
      orderBy: [
        { year: 'desc' },
        { month: 'desc' }
      ]
    });

    res.json({ payrolls });
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ error: 'Failed to fetch payroll' });
  }
});

/**
 * @swagger
 * /api/payroll/{id}:
 *   get:
 *     summary: Get payroll by ID
 *     tags: [Payroll]
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
 *         description: Payroll details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Payroll record not found
 */
router.get('/:id', async (req, res) => {
  try {
    const payrollId = parseInt(req.params.id);
    const userRole = req.user.role;

    const payroll = await prisma.payroll.findUnique({
      where: { id: payrollId },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    if (!payroll) {
      return res.status(404).json({ error: 'Payroll record not found' });
    }

    // Employees can only view their own payroll
    if (userRole === 'employee') {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (!user.employee || user.employee.id !== payroll.employeeId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ payroll });
  } catch (error) {
    console.error('Get payroll error:', error);
    res.status(500).json({ error: 'Failed to fetch payroll' });
  }
});

/**
 * @swagger
 * /api/payroll:
 *   post:
 *     summary: Generate payroll (HR Manager and Admin only)
 *     tags: [Payroll]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GeneratePayrollRequest'
 *     responses:
 *       201:
 *         description: Payroll generated successfully
 *       400:
 *         description: Validation error or payroll already exists
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Employee not found
 */
router.post('/', [
  authorize('hr_manager', 'system_admin'),
  body('employeeId').isInt(),
  body('month').isInt({ min: 1, max: 12 }),
  body('year').isInt({ min: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { employeeId, month, year } = req.body;

    // Check if payroll already exists
    const existing = await prisma.payroll.findFirst({
      where: {
        employeeId: parseInt(employeeId),
        month: parseInt(month),
        year: parseInt(year)
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeId: true
          }
        }
      }
    });

    if (existing) {
      const employeeName = existing.employee 
        ? `${existing.employee.firstName} ${existing.employee.lastName}` 
        : 'Employee';
      return res.status(400).json({ 
        error: `Payroll for ${employeeName} for ${month}/${year} already exists. Please check the payroll list or delete the existing record first.` 
      });
    }

    // Get employee
    const employee = await prisma.employee.findUnique({
      where: { id: parseInt(employeeId) }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Get attendance for the month
    // Set start date to first day of month at 00:00:00
    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    // Set end date to last day of month at 23:59:59
    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

    const attendance = await prisma.attendance.findMany({
      where: {
        employeeId: parseInt(employeeId),
        date: {
          gte: startDate,
          lte: endDate
        },
        status: 'present'
      }
    });

    const workingDays = attendance.length;
    const basicSalary = parseFloat(employee.salary);
    const allowances = basicSalary * 0.1; // 10% allowances
    const deductions = basicSalary * 0.05; // 5% deductions
    const netSalary = basicSalary + allowances - deductions;

    const payroll = await prisma.payroll.create({
      data: {
        employeeId: parseInt(employeeId),
        month: parseInt(month),
        year: parseInt(year),
        basicSalary,
        allowances,
        deductions,
        netSalary,
        workingDays,
        status: 'pending'
      },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    res.status(201).json({ payroll });
  } catch (error) {
    console.error('Generate payroll error:', error);
    res.status(500).json({ error: 'Failed to generate payroll' });
  }
});

/**
 * @swagger
 * /api/payroll/{id}/paid:
 *   put:
 *     summary: Mark payroll as paid (HR Manager and Admin only)
 *     tags: [Payroll]
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
 *         description: Payroll marked as paid
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payroll record not found
 */
router.put('/:id/paid', [
  authorize('hr_manager', 'system_admin')
], async (req, res) => {
  try {
    const payrollId = parseInt(req.params.id);

    const payroll = await prisma.payroll.update({
      where: { id: payrollId },
      data: {
        status: 'paid',
        paidDate: new Date()
      },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    res.json({ payroll });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Payroll record not found' });
    }
    console.error('Update payroll error:', error);
    res.status(500).json({ error: 'Failed to update payroll' });
  }
});

/**
 * @swagger
 * /api/payroll/{id}:
 *   delete:
 *     summary: Delete payroll record (Admin only)
 *     tags: [Payroll]
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
 *         description: Payroll record deleted successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payroll record not found
 */
router.delete('/:id', [
  authorize('system_admin')
], async (req, res) => {
  try {
    const payrollId = parseInt(req.params.id);

    const payroll = await prisma.payroll.findUnique({
      where: { id: payrollId }
    });

    if (!payroll) {
      return res.status(404).json({ error: 'Payroll record not found' });
    }

    await prisma.payroll.delete({
      where: { id: payrollId }
    });

    res.json({ message: 'Payroll record deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Payroll record not found' });
    }
    console.error('Delete payroll error:', error);
    res.status(500).json({ error: 'Failed to delete payroll record' });
  }
});

module.exports = router;

