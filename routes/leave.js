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
 * /api/leave:
 *   get:
 *     summary: Get leave requests
 *     tags: [Leave]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: List of leave requests
 */
router.get('/', async (req, res) => {
  try {
    const { status, employeeId, startDate, endDate } = req.query;
    const userRole = req.user.role;

    const where = {};

    // Employees can only see their own leaves
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

    if (status) where.status = status;
    if (startDate) where.startDate = { gte: new Date(startDate) };
    if (endDate) where.endDate = { lte: new Date(endDate) };

    const leaveRequests = await prisma.leaveRequest.findMany({
      where,
      include: {
        employee: {
          include: {
            department: true
          }
        },
        leaveType: true
      },
      orderBy: { appliedDate: 'desc' }
    });

    res.json({ leaveRequests });
  } catch (error) {
    console.error('Get leave requests error:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

/**
 * @swagger
 * /api/leave/types:
 *   get:
 *     summary: Get all leave types
 *     tags: [Leave]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of leave types
 */
router.get('/types', async (req, res) => {
  try {
    const leaveTypes = await prisma.leaveType.findMany({
      orderBy: { name: 'asc' }
    });

    res.json({ leaveTypes });
  } catch (error) {
    console.error('Get leave types error:', error);
    res.status(500).json({ error: 'Failed to fetch leave types' });
  }
});

/**
 * @swagger
 * /api/leave/types:
 *   post:
 *     summary: Create leave type (HR Manager and Admin only)
 *     tags: [Leave]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - days
 *             properties:
 *               name:
 *                 type: string
 *               days:
 *                 type: integer
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Leave type created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 */
router.post('/types', [
  authorize('hr_manager', 'system_admin'),
  body('name').notEmpty().withMessage('Name is required'),
  body('days').isInt({ min: 1 }).withMessage('Days must be a positive integer'),
  body('description').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, days, description } = req.body;

    const normalizedName = name.trim().toLowerCase();

    // Check for duplicate name (case-insensitive) - MySQL doesn't support mode: 'insensitive'
    const existingLeaveTypes = await prisma.leaveType.findMany({
      select: { name: true }
    });
    const duplicate = existingLeaveTypes.some(
      lt => (lt.name || '').trim().toLowerCase() === normalizedName
    );

    if (duplicate) {
      return res.status(400).json({ error: 'A leave type with this name already exists' });
    }

    const leaveType = await prisma.leaveType.create({
      data: {
        name: name.trim(),
        days: parseInt(days),
        description: description ? description.trim() : null
      }
    });

    res.status(201).json({ leaveType });
  } catch (error) {
    console.error('Create leave type error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A leave type with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create leave type' });
  }
});

/**
 * @swagger
 * /api/leave/types/{id}:
 *   put:
 *     summary: Update leave type (HR Manager and Admin only)
 *     tags: [Leave]
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
 *               days:
 *                 type: integer
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Leave type updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Leave type not found
 */
router.put('/types/:id', [
  authorize('hr_manager', 'system_admin'),
  body('name').optional().notEmpty(),
  body('days').optional().isInt({ min: 1 }),
  body('description').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const leaveTypeId = parseInt(req.params.id);
    const { name, days, description } = req.body;

    // Check if leave type exists
    const existingLeaveType = await prisma.leaveType.findUnique({
      where: { id: leaveTypeId }
    });

    if (!existingLeaveType) {
      return res.status(404).json({ error: 'Leave type not found' });
    }

    // Check for duplicate name if name is being updated
    if (name !== undefined && name.trim().toLowerCase() !== existingLeaveType.name.toLowerCase()) {
      const allLeaveTypes = await prisma.leaveType.findMany({
        where: {
          id: { not: leaveTypeId } // Exclude current leave type
        }
      });
      const duplicate = allLeaveTypes.find(lt => lt.name.toLowerCase() === name.trim().toLowerCase());

      if (duplicate) {
        return res.status(400).json({ error: 'A leave type with this name already exists' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (days !== undefined) updateData.days = parseInt(days);
    if (description !== undefined) updateData.description = description ? description.trim() : null;

    const leaveType = await prisma.leaveType.update({
      where: { id: leaveTypeId },
      data: updateData
    });

    res.json({ leaveType });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Leave type not found' });
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A leave type with this name already exists' });
    }
    console.error('Update leave type error:', error);
    res.status(500).json({ error: 'Failed to update leave type' });
  }
});

/**
 * @swagger
 * /api/leave/types/{id}:
 *   delete:
 *     summary: Delete leave type (Admin only)
 *     tags: [Leave]
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
 *         description: Leave type deleted successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Leave type not found
 *       400:
 *         description: Cannot delete leave type that is in use
 */
router.delete('/types/:id', [
  authorize('system_admin')
], async (req, res) => {
  try {
    const leaveTypeId = parseInt(req.params.id);

    // Check if leave type is being used
    const leaveRequests = await prisma.leaveRequest.findFirst({
      where: { leaveTypeId }
    });

    if (leaveRequests) {
      return res.status(400).json({ error: 'Cannot delete leave type that is being used by leave requests' });
    }

    await prisma.leaveType.delete({
      where: { id: leaveTypeId }
    });

    res.json({ message: 'Leave type deleted successfully' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Leave type not found' });
    }
    console.error('Delete leave type error:', error);
    res.status(500).json({ error: 'Failed to delete leave type' });
  }
});

/**
 * @swagger
 * /api/leave/{id}:
 *   get:
 *     summary: Get leave request by ID
 *     tags: [Leave]
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
 *         description: Leave request details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Leave request not found
 */
router.get('/:id', async (req, res) => {
  try {
    const leaveId = parseInt(req.params.id);
    const userRole = req.user.role;

    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: leaveId },
      include: {
        employee: {
          include: {
            department: true
          }
        },
        leaveType: true
      }
    });

    if (!leaveRequest) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    // Employees can only view their own leaves
    if (userRole === 'employee') {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (!user.employee || user.employee.id !== leaveRequest.employeeId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json({ leaveRequest });
  } catch (error) {
    console.error('Get leave request error:', error);
    res.status(500).json({ error: 'Failed to fetch leave request' });
  }
});

/**
 * @swagger
 * /api/leave:
 *   post:
 *     summary: Create leave request
 *     tags: [Leave]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateLeaveRequest'
 *     responses:
 *       201:
 *         description: Leave request created successfully
 *       400:
 *         description: Validation error
 */
router.post('/', [
  body('leaveTypeId').isInt(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('reason').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Get employee for current user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { employee: true }
    });

    if (!user.employee) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const { leaveTypeId, startDate, endDate, reason } = req.body;

    // Calculate days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    // Verify leave type exists
    const leaveType = await prisma.leaveType.findUnique({
      where: { id: parseInt(leaveTypeId) }
    });

    if (!leaveType) {
      return res.status(404).json({ error: 'Leave type not found' });
    }

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: user.employee.id,
        leaveTypeId: parseInt(leaveTypeId),
        startDate: start,
        endDate: end,
        days,
        reason,
        status: 'pending'
      },
      include: {
        employee: {
          include: {
            department: true
          }
        },
        leaveType: true
      }
    });

    res.status(201).json({ leaveRequest });
  } catch (error) {
    console.error('Create leave request error:', error);
    res.status(500).json({ error: 'Failed to create leave request' });
  }
});

/**
 * PUT /api/leave/:id/approve
 * Approve leave request (HR Manager and Admin only)
 */
router.put('/:id/approve', [
  authorize('hr_manager', 'system_admin'),
  body('comments').optional()
], async (req, res) => {
  try {
    const leaveId = parseInt(req.params.id);
    const { comments } = req.body;

    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status: 'approved',
        approvedBy: req.user.id,
        approvedDate: new Date(),
        comments
      },
      include: {
        employee: {
          include: {
            department: true
          }
        },
        leaveType: true
      }
    });

    res.json({ leaveRequest });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    console.error('Approve leave request error:', error);
    res.status(500).json({ error: 'Failed to approve leave request' });
  }
});

/**
 * @swagger
 * /api/leave/{id}/reject:
 *   put:
 *     summary: Reject leave request (HR Manager and Admin only)
 *     tags: [Leave]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               comments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Leave request rejected
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Leave request not found
 */
router.put('/:id/reject', [
  authorize('hr_manager', 'system_admin'),
  body('comments').optional()
], async (req, res) => {
  try {
    const leaveId = parseInt(req.params.id);
    const { comments } = req.body;

    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status: 'rejected',
        approvedBy: req.user.id,
        approvedDate: new Date(),
        comments
      },
      include: {
        employee: {
          include: {
            department: true
          }
        },
        leaveType: true
      }
    });

    res.json({ leaveRequest });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Leave request not found' });
    }
    console.error('Reject leave request error:', error);
    res.status(500).json({ error: 'Failed to reject leave request' });
  }
});

module.exports = router;

