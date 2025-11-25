const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Public routes (no authentication required)
/**
 * @swagger
 * /api/recruitment/public/jobs:
 *   get:
 *     summary: Get public job vacancies (open jobs only)
 *     description: Public endpoint to view open job vacancies. No authentication required.
 *     tags: [Recruitment]
 *     responses:
 *       200:
 *         description: List of open job vacancies
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       title:
 *                         type: string
 *                       department:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                       description:
 *                         type: string
 *                       requirements:
 *                         type: string
 *                       openingDate:
 *                         type: string
 *                         format: date-time
 *                       closingDate:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 */
router.get('/public/jobs', async (req, res) => {
  try {
    const jobs = await prisma.jobVacancy.findMany({
      where: {
        status: 'open',
        closingDate: {
          gte: new Date() // Only show jobs that haven't closed yet
        }
      },
      include: {
        department: true
      },
      orderBy: { postedDate: 'desc' }
    });

    res.json({ jobs });
  } catch (error) {
    console.error('Get public jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch job vacancies' });
  }
});

/**
 * @swagger
 * /api/recruitment/public/jobs/{id}:
 *   get:
 *     summary: Get public job vacancy details by ID
 *     description: Public endpoint to view job details. No authentication required.
 *     tags: [Recruitment]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Job vacancy details
 *       404:
 *         description: Job vacancy not found or not open
 */
router.get('/public/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);

    const job = await prisma.jobVacancy.findUnique({
      where: { id: jobId },
      include: {
        department: true
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job vacancy not found' });
    }

    if (job.status !== 'open') {
      return res.status(404).json({ error: 'This job vacancy is no longer accepting applications' });
    }

    res.json({ job });
  } catch (error) {
    console.error('Get public job error:', error);
    res.status(500).json({ error: 'Failed to fetch job vacancy' });
  }
});

/**
 * @swagger
 * /api/recruitment/public/apply:
 *   post:
 *     summary: Submit job application (Public - no authentication required)
 *     description: Public endpoint to submit job applications. No authentication required.
 *     tags: [Recruitment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobVacancyId
 *               - firstName
 *               - lastName
 *               - email
 *             properties:
 *               jobVacancyId:
 *                 type: integer
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               resume:
 *                 type: string
 *                 description: URL to resume file
 *               coverLetter:
 *                 type: string
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *       400:
 *         description: Validation error or job not accepting applications
 *       404:
 *         description: Job vacancy not found
 */
router.post('/public/apply', [
  body('jobVacancyId').isInt(),
  body('firstName').notEmpty().trim(),
  body('lastName').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').optional().trim(),
  body('resume').optional().trim(),
  body('coverLetter').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      jobVacancyId,
      firstName,
      lastName,
      email,
      phone,
      resume,
      coverLetter
    } = req.body;

    // Verify job exists and is open
    const job = await prisma.jobVacancy.findUnique({
      where: { id: parseInt(jobVacancyId) },
      include: { department: true }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job vacancy not found' });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ error: 'This job vacancy is no longer accepting applications' });
    }

    // Check if closing date has passed
    if (job.closingDate && new Date(job.closingDate) < new Date()) {
      return res.status(400).json({ error: 'The application deadline for this position has passed' });
    }

    // Check if applicant already applied for this job
    const existingApplication = await prisma.applicant.findFirst({
      where: {
        jobVacancyId: parseInt(jobVacancyId),
        email: email
      }
    });

    if (existingApplication) {
      return res.status(400).json({ error: 'You have already applied for this position' });
    }

    const applicant = await prisma.applicant.create({
      data: {
        jobVacancyId: parseInt(jobVacancyId),
        firstName,
        lastName,
        email,
        phone: phone || null,
        resume: resume || null,
        coverLetter: coverLetter || null,
        status: 'pending'
      },
      include: {
        jobVacancy: {
          include: {
            department: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Application submitted successfully',
      applicant: {
        id: applicant.id,
        firstName: applicant.firstName,
        lastName: applicant.lastName,
        email: applicant.email,
        jobTitle: applicant.jobVacancy.title
      }
    });
  } catch (error) {
    console.error('Public apply error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'You have already applied for this position' });
    }
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// Protected routes (require authentication)
router.use(authenticate);

/**
 * @swagger
 * /api/recruitment/jobs:
 *   get:
 *     summary: Get job vacancies
 *     tags: [Recruitment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, closed, filled]
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of job vacancies
 */
router.get('/jobs', async (req, res) => {
  try {
    const { status, departmentId } = req.query;

    const where = {};
    if (status) where.status = status;
    if (departmentId) where.departmentId = parseInt(departmentId);

    const jobs = await prisma.jobVacancy.findMany({
      where,
      include: {
        department: true,
        _count: {
          select: { applicants: true }
        }
      },
      orderBy: { postedDate: 'desc' }
    });

    res.json({ jobs });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch job vacancies' });
  }
});

/**
 * @swagger
 * /api/recruitment/jobs/{id}:
 *   get:
 *     summary: Get job vacancy by ID
 *     tags: [Recruitment]
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
 *         description: Job vacancy details
 *       404:
 *         description: Job vacancy not found
 */
router.get('/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);

    const job = await prisma.jobVacancy.findUnique({
      where: { id: jobId },
      include: {
        department: true,
        applicants: {
          orderBy: { appliedDate: 'desc' }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job vacancy not found' });
    }

    res.json({ job });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Failed to fetch job vacancy' });
  }
});

/**
 * @swagger
 * /api/recruitment/jobs:
 *   post:
 *     summary: Create job vacancy (HR Manager and Admin only)
 *     tags: [Recruitment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateJobVacancyRequest'
 *     responses:
 *       201:
 *         description: Job vacancy created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 */
router.post('/jobs', [
  authorize('hr_manager', 'system_admin'),
  body('title').notEmpty(),
  body('departmentId').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      departmentId,
      description,
      requirements,
      salaryRange,
      closingDate,
      status = 'open'
    } = req.body;

    const job = await prisma.jobVacancy.create({
      data: {
        title,
        departmentId: parseInt(departmentId),
        description,
        requirements,
        salaryRange,
        closingDate: closingDate ? new Date(closingDate) : null,
        status
      },
      include: {
        department: true
      }
    });

    res.status(201).json({ job });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job vacancy' });
  }
});

/**
 * @swagger
 * /api/recruitment/jobs/{id}:
 *   put:
 *     summary: Update job vacancy (HR Manager and Admin only)
 *     tags: [Recruitment]
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
 *               title:
 *                 type: string
 *               departmentId:
 *                 type: integer
 *               description:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [open, closed, filled]
 *     responses:
 *       200:
 *         description: Job vacancy updated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Job vacancy not found
 */
router.put('/jobs/:id', [
  authorize('hr_manager', 'system_admin')
], async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const updateData = { ...req.body };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    // Convert date strings
    if (updateData.closingDate) {
      updateData.closingDate = new Date(updateData.closingDate);
    }
    if (updateData.departmentId) {
      updateData.departmentId = parseInt(updateData.departmentId);
    }

    const job = await prisma.jobVacancy.update({
      where: { id: jobId },
      data: updateData,
      include: {
        department: true
      }
    });

    res.json({ job });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Job vacancy not found' });
    }
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job vacancy' });
  }
});

/**
 * @swagger
 * /api/recruitment/applicants:
 *   get:
 *     summary: Get applicants (HR Manager and Admin only)
 *     tags: [Recruitment]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: jobVacancyId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, shortlisted, rejected, hired]
 *     responses:
 *       200:
 *         description: List of applicants
 *       403:
 *         description: Insufficient permissions
 */
router.get('/applicants', [
  authorize('hr_manager', 'system_admin')
], async (req, res) => {
  try {
    const { jobVacancyId, status } = req.query;

    const where = {};
    if (jobVacancyId) where.jobVacancyId = parseInt(jobVacancyId);
    if (status) where.status = status;

    const applicants = await prisma.applicant.findMany({
      where,
      include: {
        jobVacancy: {
          include: {
            department: true
          }
        }
      },
      orderBy: { appliedDate: 'desc' }
    });

    res.json({ applicants });
  } catch (error) {
    console.error('Get applicants error:', error);
    res.status(500).json({ error: 'Failed to fetch applicants' });
  }
});

/**
 * @swagger
 * /api/recruitment/applicants:
 *   post:
 *     summary: Create applicant (apply for job)
 *     tags: [Recruitment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateApplicantRequest'
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *       400:
 *         description: Validation error or job not accepting applications
 *       404:
 *         description: Job vacancy not found
 */
router.post('/applicants', [
  body('jobVacancyId').isInt(),
  body('firstName').notEmpty(),
  body('lastName').notEmpty(),
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      jobVacancyId,
      firstName,
      lastName,
      email,
      phone,
      resume,
      coverLetter
    } = req.body;

    // Verify job exists and is open
    const job = await prisma.jobVacancy.findUnique({
      where: { id: parseInt(jobVacancyId) }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job vacancy not found' });
    }

    if (job.status !== 'open') {
      return res.status(400).json({ error: 'This job vacancy is no longer accepting applications' });
    }

    const applicant = await prisma.applicant.create({
      data: {
        jobVacancyId: parseInt(jobVacancyId),
        firstName,
        lastName,
        email,
        phone,
        resume,
        coverLetter,
        status: 'pending'
      },
      include: {
        jobVacancy: {
          include: {
            department: true
          }
        }
      }
    });

    res.status(201).json({ applicant });
  } catch (error) {
    console.error('Create applicant error:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

/**
 * @swagger
 * /api/recruitment/applicants/{id}/status:
 *   put:
 *     summary: Update applicant status (HR Manager and Admin only)
 *     tags: [Recruitment]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, shortlisted, rejected, hired]
 *               notes:
 *                 type: string
 *               interviewDate:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Applicant status updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Applicant not found
 */
router.put('/applicants/:id/status', [
  authorize('hr_manager', 'system_admin'),
  body('status').isIn(['pending', 'shortlisted', 'rejected', 'hired']),
  body('notes').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const applicantId = parseInt(req.params.id);
    const { status, notes, interviewDate } = req.body;

    const updateData = { status };
    if (notes) updateData.notes = notes;
    if (interviewDate) updateData.interviewDate = new Date(interviewDate);

    const applicant = await prisma.applicant.update({
      where: { id: applicantId },
      data: updateData,
      include: {
        jobVacancy: {
          include: {
            department: true
          }
        }
      }
    });

    res.json({ applicant });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Applicant not found' });
    }
    console.error('Update applicant error:', error);
    res.status(500).json({ error: 'Failed to update applicant status' });
  }
});

module.exports = router;

