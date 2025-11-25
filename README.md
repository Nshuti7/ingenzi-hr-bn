# INGENZI HRMS Backend API

Backend API for INGENZI HRMS built with Express.js, Prisma ORM, and MySQL.

## Features

- ✅ RESTful API with Express.js
- ✅ Prisma ORM with MySQL
- ✅ JWT Authentication
- ✅ Role-based Access Control (Employee, HR Manager, System Admin)
- ✅ Complete CRUD operations for all HRMS modules
- ✅ Input validation with express-validator
- ✅ Error handling middleware
- ✅ Swagger/OpenAPI Documentation

## Prerequisites

- Node.js (v16 or higher)
- MySQL (v8.0 or higher)
- npm or yarn

## Installation

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the `backend` directory:
   ```env
   PORT=3001
   NODE_ENV=development
   DATABASE_URL="mysql://username:password@localhost:3306/ingenzi_hrms"
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   JWT_EXPIRES_IN=7d
   FRONTEND_URL=http://localhost:3000
   ```

3. **Set up MySQL database:**
   - Create a MySQL database named `ingenzi_hrms`
   - Update the `DATABASE_URL` in `.env` with your MySQL credentials

4. **Run Prisma migrations:**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Generate Prisma Client:**
   ```bash
   npx prisma generate
   ```

6. **Seed the database (optional):**
   ```bash
   npm run prisma:seed
   ```

## Running the Server

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The API will be available at `http://localhost:3001`

## API Documentation (Swagger)

Access the interactive API documentation at:
```
http://localhost:3001/api-docs
```

The Swagger UI provides:
- Interactive API testing
- Request/response schemas
- Authentication support
- Try-it-out functionality for all endpoints

See `SWAGGER_SETUP.md` for detailed instructions on using Swagger.

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/register` - Register new user (Admin only)
- `GET /api/auth/me` - Get current user

### Employees
- `GET /api/employees` - Get all employees (HR Manager/Admin)
- `GET /api/employees/:id` - Get employee by ID
- `POST /api/employees` - Create employee (HR Manager/Admin)
- `PUT /api/employees/:id` - Update employee (HR Manager/Admin)
- `DELETE /api/employees/:id` - Delete employee (Admin only)

### Departments
- `GET /api/departments` - Get all departments
- `GET /api/departments/:id` - Get department by ID
- `POST /api/departments` - Create department (HR Manager/Admin)
- `PUT /api/departments/:id` - Update department (HR Manager/Admin)
- `DELETE /api/departments/:id` - Delete department (Admin only)

### Leave Management
- `GET /api/leave` - Get leave requests
- `GET /api/leave/:id` - Get leave request by ID
- `POST /api/leave` - Create leave request
- `PUT /api/leave/:id/approve` - Approve leave (HR Manager/Admin)
- `PUT /api/leave/:id/reject` - Reject leave (HR Manager/Admin)
- `GET /api/leave/types` - Get all leave types

### Attendance
- `GET /api/attendance` - Get attendance records
- `POST /api/attendance/checkin` - Check in
- `POST /api/attendance/checkout` - Check out
- `POST /api/attendance` - Create/update attendance (HR Manager/Admin)

### Payroll
- `GET /api/payroll` - Get payroll records
- `GET /api/payroll/:id` - Get payroll by ID
- `POST /api/payroll` - Generate payroll (HR Manager/Admin)
- `PUT /api/payroll/:id/paid` - Mark payroll as paid (HR Manager/Admin)

### Recruitment
- `GET /api/recruitment/jobs` - Get job vacancies
- `GET /api/recruitment/jobs/:id` - Get job by ID
- `POST /api/recruitment/jobs` - Create job vacancy (HR Manager/Admin)
- `PUT /api/recruitment/jobs/:id` - Update job vacancy (HR Manager/Admin)
- `GET /api/recruitment/applicants` - Get applicants (HR Manager/Admin)
- `POST /api/recruitment/applicants` - Apply for job
- `PUT /api/recruitment/applicants/:id/status` - Update applicant status (HR Manager/Admin)

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/recent-activity` - Get recent activity

## Authentication

All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Default Users (from seed)

After running the seed script, you can login with:

**Employee:**
- Email: `employee@ingenzi.com`
- Password: `testpassword`

**HR Manager:**
- Email: `hr@ingenzi.com`
- Password: `testpassword`

**System Admin:**
- Email: `admin@ingenzi.com`
- Password: `testpassword`

## Database Schema

The Prisma schema includes:
- Users (with roles)
- Employees
- Departments
- Leave Types & Leave Requests
- Attendance
- Payroll
- Job Vacancies & Applicants

## Development

**View database in Prisma Studio:**
```bash
npm run prisma:studio
```

**Create a new migration:**
```bash
npx prisma migrate dev --name migration_name
```

**Reset database:**
```bash
npx prisma migrate reset
```

## License

Copyright © INGENZI. All rights reserved.

