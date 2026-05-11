# Namaz Yoklama Backend

NestJS + PostgreSQL + Prisma backend foundation for the Namaz Yoklama multi-institution attendance system.

## Setup

```bash
npm install
cp .env.example .env
```

## Start PostgreSQL

```bash
docker compose up -d
```

## Prisma

```bash
npx prisma migrate dev --name init
npx prisma db seed
```

The seed creates the first super admin:

- Email: `admin@example.com`
- Password: `admin123456`

## Run Development Server

```bash
npm run start:dev
```

## Test Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123456"}'
```

Set the returned token:

```bash
export TOKEN="paste_access_token_here"
```

## Step 2 Endpoint Examples

### Create Institution

```bash
curl -X POST http://localhost:3000/institutions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Merkez Kurum","city":"İstanbul","district":"Üsküdar","address":"Adres","phone":"5551112233"}'
```

### Create Institution Admin

```bash
curl -X POST http://localhost:3000/users/institution-user \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"kurum.admin@example.com","password":"password123","fullName":"Kurum Admin","institutionId":"INSTITUTION_UUID","institutionRole":"INSTITUTION_ADMIN","assignedClassGroupIds":[]}'
```

### Create Class Group

```bash
curl -X POST http://localhost:3000/class-groups \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"institutionId":"INSTITUTION_UUID","name":"5-A","teacherName":"Ahmet Hoca"}'
```

### Create Student

```bash
curl -X POST http://localhost:3000/students \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"institutionId":"INSTITUTION_UUID","classGroupId":"CLASS_GROUP_UUID","fullName":"Mehmet Yılmaz"}'
```

### Create Prayer Type

```bash
curl -X POST http://localhost:3000/prayer-types \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"institutionId":"INSTITUTION_UUID","name":"Sabah","sortOrder":1}'
```

### Create Recorder Or Viewer

```bash
curl -X POST http://localhost:3000/users/institution-user \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"recorder@example.com","password":"password123","fullName":"Yoklamacı","institutionId":"INSTITUTION_UUID","institutionRole":"RECORDER","assignedClassGroupIds":["CLASS_GROUP_UUID"]}'
```

```bash
curl -X POST http://localhost:3000/users/institution-user \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"viewer@example.com","password":"password123","fullName":"Gözlemci","institutionId":"INSTITUTION_UUID","institutionRole":"VIEWER","assignedClassGroupIds":[]}'
```

### List Scoped Data

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/users?institutionId=INSTITUTION_UUID"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/class-groups?institutionId=INSTITUTION_UUID"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/students?institutionId=INSTITUTION_UUID"
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/prayer-types?institutionId=INSTITUTION_UUID"
```

## Step 3 Attendance And Reports

### Bulk Save Attendance

```bash
curl -X POST http://localhost:3000/attendance/bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"institutionId":"INSTITUTION_UUID","date":"2026-05-10","prayerTypeId":"PRAYER_TYPE_UUID","records":[{"studentId":"STUDENT_UUID","status":"PRESENT"}]}'
```

### Get Attendance By Date And Prayer

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/attendance/by-date-prayer?institutionId=INSTITUTION_UUID&date=2026-05-10&prayerTypeId=PRAYER_TYPE_UUID"
```

### Get Attendance List

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/attendance?institutionId=INSTITUTION_UUID&startDate=2026-05-01&endDate=2026-05-10"
```

### Get Report Summary

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/reports/summary?institutionId=INSTITUTION_UUID&startDate=2026-05-01&endDate=2026-05-10"
```

### Get Class Summary

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/reports/class-summary?institutionId=INSTITUTION_UUID&startDate=2026-05-01&endDate=2026-05-10"
```

### Get Student Summary

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/reports/student-summary?institutionId=INSTITUTION_UUID&startDate=2026-05-01&endDate=2026-05-10&sortBy=rate&sortDirection=asc"
```

### Get Student Detail Report

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/reports/student/STUDENT_UUID?startDate=2026-05-01&endDate=2026-05-10"
```

### Get Percentiles

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/reports/percentiles?institutionId=INSTITUTION_UUID&startDate=2026-05-01&endDate=2026-05-10"
```

## Useful Scripts

```bash
npm run build
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:studio
npm run seed
```

## Implemented In This Foundation

- JWT authentication
- bcrypt password hashing
- Prisma schema for institutions, users, class groups, students, prayer types, and attendance
- Global and institution role enums
- Current user decorator
- JWT guard
- Role guard infrastructure
- Permission helper functions
- Institution CRUD with soft deactivate
- Global manager creation endpoint for `super_admin`
- Institution user management endpoints
- Class group, student, and prayer type management endpoints
- Institution and assigned-class scope enforcement in services
- Attendance list, by-date-prayer, bulk upsert, and single update endpoints
- JSON report endpoints for summary, class summary, student summary, student detail, and percentiles

No Flutter code is used by this backend project.
