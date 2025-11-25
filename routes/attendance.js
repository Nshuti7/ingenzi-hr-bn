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
 * /api/attendance:
 *   get:
 *     summary: Get attendance records
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *         description: List of attendance records
 */
router.get('/', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    const userRole = req.user.role;

    const where = {};

    // Employees can only see their own attendance
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

    if (startDate) where.date = { gte: new Date(startDate) };
    if (endDate) {
      where.date = {
        ...where.date,
        lte: new Date(endDate)
      };
    }

    const attendance = await prisma.attendance.findMany({
      where,
      include: {
        employee: {
          include: {
            department: true
          }
        }
      },
      orderBy: { date: 'desc' }
    });

    res.json({ attendance });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

/**
 * @swagger
 * /api/attendance/checkin:
 *   post:
 *     summary: Check in (mark attendance)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Checked in successfully
 *       400:
 *         description: Already checked in today
 *       404:
 *         description: Employee record not found
 */
router.post('/checkin', async (req, res) => {
  try {
    // Get employee for current user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { employee: true }
    });

    if (!user.employee) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if attendance already exists for today
    const existing = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: user.employee.id,
          date: today
        }
      }
    });

    if (existing && existing.checkIn) {
      return res.status(400).json({ error: 'Already checked in today' });
    }

    const attendance = await prisma.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId: user.employee.id,
          date: today
        }
      },
      update: {
        checkIn: new Date(),
        status: 'present'
      },
      create: {
        employeeId: user.employee.id,
        date: today,
        checkIn: new Date(),
        status: 'present'
      },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    res.status(201).json({ attendance });
  } catch (error) {
    console.error('Check in error:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

/**
 * @swagger
 * /api/attendance/checkout:
 *   post:
 *     summary: Check out
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Checked out successfully
 *       400:
 *         description: Please check in first or already checked out
 *       404:
 *         description: Employee record not found
 */
router.post('/checkout', async (req, res) => {
  try {
    // Get employee for current user
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { employee: true }
    });

    if (!user.employee) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find today's attendance
    const attendance = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: user.employee.id,
          date: today
        }
      }
    });

    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({ error: 'Please check in first' });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ error: 'Already checked out today' });
    }

    const checkOutTime = new Date();
    const checkInTime = new Date(attendance.checkIn);
    const hoursWorked = (checkOutTime - checkInTime) / (1000 * 60 * 60);

    const updated = await prisma.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: checkOutTime,
        hoursWorked: hoursWorked.toFixed(2)
      },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    res.json({ attendance: updated });
  } catch (error) {
    console.error('Check out error:', error);
    res.status(500).json({ error: 'Failed to check out' });
  }
});

/**
 * @swagger
 * /api/attendance:
 *   post:
 *     summary: Create/update attendance record (HR Manager and Admin only)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAttendanceRequest'
 *     responses:
 *       201:
 *         description: Attendance record created/updated
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', [
  authorize('hr_manager', 'system_admin'),
  body('employeeId').isInt(),
  body('date').isISO8601(),
  body('status').isIn(['present', 'absent', 'late', 'half_day'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { employeeId, date, checkIn, checkOut, status, notes } = req.body;

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    let hoursWorked = null;
    if (checkIn && checkOut) {
      const checkInTime = new Date(checkIn);
      const checkOutTime = new Date(checkOut);
      hoursWorked = (checkOutTime - checkInTime) / (1000 * 60 * 60);
    }

    const attendance = await prisma.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId: parseInt(employeeId),
          date: attendanceDate
        }
      },
      update: {
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        hoursWorked: hoursWorked ? hoursWorked.toFixed(2) : null,
        status,
        notes
      },
      create: {
        employeeId: parseInt(employeeId),
        date: attendanceDate,
        checkIn: checkIn ? new Date(checkIn) : null,
        checkOut: checkOut ? new Date(checkOut) : null,
        hoursWorked: hoursWorked ? hoursWorked.toFixed(2) : null,
        status,
        notes
      },
      include: {
        employee: {
          include: {
            department: true
          }
        }
      }
    });

    res.status(201).json({ attendance });
  } catch (error) {
    console.error('Create attendance error:', error);
    res.status(500).json({ error: 'Failed to create attendance record' });
  }
});

module.exports = router;

