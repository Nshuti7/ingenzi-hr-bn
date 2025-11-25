const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /api/dashboard/stats:
 *   get:
 *     summary: Get dashboard statistics
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 employees:
 *                   type: integer
 *                 departments:
 *                   type: integer
 *                 pendingLeaves:
 *                   type: integer
 *                 recruitments:
 *                   type: integer
 */
router.get('/stats', async (req, res) => {
  try {
    const userRole = req.user.role;

    if (userRole === 'employee') {
      // Employee sees only their own stats
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (!user.employee) {
        return res.json({
          employees: 0,
          departments: 0,
          pendingLeaves: 0,
          recruitments: 0
        });
      }

      const myLeaves = await prisma.leaveRequest.count({
        where: {
          employeeId: user.employee.id,
          status: 'pending'
        }
      });

      const myPayroll = await prisma.payroll.count({
        where: {
          employeeId: user.employee.id
        }
      });

      const myTotalLeaves = await prisma.leaveRequest.count({
        where: {
          employeeId: user.employee.id
        }
      });

      res.json({
        myPendingLeaves: myLeaves,
        myTotalLeaves: myTotalLeaves,
        myPayroll: myPayroll
      });
    } else {
      // HR Managers and Admins see all stats
      // Get today's date range (start and end of day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const [
        totalEmployees,
        totalDepartments,
        pendingLeaves,
        todayAttendance,
        activeRecruitments,
        totalUsers
      ] = await Promise.all([
        prisma.employee.count({ where: { status: 'active' } }),
        prisma.department.count({ where: { status: 'active' } }),
        prisma.leaveRequest.count({ where: { status: 'pending' } }),
        prisma.attendance.count({
          where: {
            date: {
              gte: today,
              lte: todayEnd
            },
            status: 'present'
          }
        }),
        prisma.jobVacancy.count({ where: { status: 'open' } }),
        userRole === 'system_admin' ? prisma.user.count() : Promise.resolve(0)
      ]);

      const response = {
        totalEmployees,
        totalDepartments,
        pendingLeaves,
        todayAttendance
      };

      // Admin-only stats
      if (userRole === 'system_admin') {
        response.activeRecruitments = activeRecruitments;
        response.totalUsers = totalUsers;
      }

      res.json(response);
    }
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

/**
 * @swagger
 * /api/dashboard/recent-activity:
 *   get:
 *     summary: Get recent activity
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recent activity list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       icon:
 *                         type: string
 *                       iconColor:
 *                         type: string
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       time:
 *                         type: string
 */
router.get('/recent-activity', async (req, res) => {
  try {
    const userRole = req.user.role;
    const activities = [];

    if (userRole === 'employee') {
      // Employees see only their own activity
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { employee: true }
      });

      if (user.employee) {
        const myLeaves = await prisma.leaveRequest.findMany({
          where: { employeeId: user.employee.id },
          include: { leaveType: true },
          orderBy: { appliedDate: 'desc' },
          take: 3
        });

        myLeaves.forEach(leave => {
          activities.push({
            type: 'leave',
            icon: leave.status === 'approved' ? 'check-circle' : leave.status === 'rejected' ? 'x-circle' : 'clock',
            iconColor: leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'danger' : 'warning',
            title: `Leave Request ${leave.status}`,
            description: `${leave.leaveType.name} - ${leave.startDate.toLocaleDateString()} to ${leave.endDate.toLocaleDateString()}`,
            time: leave.appliedDate
          });
        });
      }
    } else {
      // HR Managers and Admins see all activity
      const [recentEmployees, recentLeaves, recentJobs] = await Promise.all([
        prisma.employee.findMany({
          include: { department: true },
          orderBy: { createdAt: 'desc' },
          take: 2
        }),
        prisma.leaveRequest.findMany({
          where: { status: 'approved' },
          include: { employee: true },
          orderBy: { approvedDate: 'desc' },
          take: 2
        }),
        prisma.jobVacancy.findMany({
          include: { department: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        })
      ]);

      recentEmployees.forEach(emp => {
        activities.push({
          type: 'employee',
          icon: 'user-plus',
          iconColor: 'primary',
          title: 'New Employee Added',
          description: `${emp.firstName} ${emp.lastName} joined ${emp.department.name}`,
          time: emp.createdAt
        });
      });

      recentLeaves.forEach(leave => {
        activities.push({
          type: 'leave',
          icon: 'check-circle',
          iconColor: 'success',
          title: 'Leave Approved',
          description: `${leave.employee.firstName} ${leave.employee.lastName}'s leave request approved`,
          time: leave.approvedDate || leave.appliedDate
        });
      });

      recentJobs.forEach(job => {
        activities.push({
          type: 'job',
          icon: 'briefcase',
          iconColor: 'info',
          title: 'New Job Posted',
          description: `${job.title} position opened`,
          time: job.createdAt
        });
      });
    }

    // Sort by time and take latest 3
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const displayActivities = activities.slice(0, 3);

    res.json({ activities: displayActivities });
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

module.exports = router;

