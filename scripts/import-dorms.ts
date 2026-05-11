import { GlobalRole, InstitutionRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

const projectRoot = path.resolve(__dirname, '..');
const importDir = process.env.IMPORT_DORMS_DIR
  ? path.resolve(process.env.IMPORT_DORMS_DIR)
  : path.join(projectRoot, 'data/imports');

const dormFiles = [
  { fileName: 'OSMANBEY.xlsx', institutionName: 'Osmanbey', district: 'Osmanbey' },
  { fileName: 'AYAZAĞA.xlsx', institutionName: 'Ayazağa', district: 'Ayazağa' },
  {
    fileName: 'Şehzadebaşı.xlsx',
    institutionName: 'Şehzadebaşı',
    district: 'Şehzadebaşı',
  },
];

type Counter = {
  created: number;
  updated: number;
};

type ImportSummary = {
  institutions: Counter;
  groups: Counter;
  students: Counter;
  groupResponsibles: Counter;
  skippedRows: number;
  importedInstitutions: Set<string>;
  importedGroups: Set<string>;
  importedStudents: Set<string>;
  importedTeachers: Set<string>;
  teacherAssignments: string[];
};

type HeaderColumns = {
  studentNumber?: number;
  groupName: number;
  teacherName?: number;
  fullName: number;
};

type DormRow = {
  studentNumber: string | null;
  groupName: string;
  teacherName: string | null;
  fullName: string;
};

type DormImportConfig = (typeof dormFiles)[number];
type TeacherGroupAssignment = { id: string; name: string };

const summary: ImportSummary = {
  institutions: { created: 0, updated: 0 },
  groups: { created: 0, updated: 0 },
  students: { created: 0, updated: 0 },
  groupResponsibles: { created: 0, updated: 0 },
  skippedRows: 0,
  importedInstitutions: new Set<string>(),
  importedGroups: new Set<string>(),
  importedStudents: new Set<string>(),
  importedTeachers: new Set<string>(),
  teacherAssignments: [],
};

const badCellValues = new Set([
  '#REF!',
  '#VALUE!',
  '#N/A',
  '#DIV/0!',
  '#NAME?',
  '#NUM!',
  '#NULL!',
]);

async function main() {
  const passwordHash = await bcrypt.hash(
    process.env.IMPORT_DORMS_RESPONSIBLE_PASSWORD || 'imported123456',
    12,
  );

  for (const dorm of dormFiles) {
    const filePath = findImportFile(dorm.fileName);
    const rows = readDormRows(filePath);
    await importDorm(dorm, rows, passwordHash);
  }

  printSummary();
}

function findImportFile(fileName: string) {
  if (!fs.existsSync(importDir)) {
    throw new Error(`Import klasörü bulunamadı: ${importDir}`);
  }

  const directPath = path.join(importDir, fileName);
  if (fs.existsSync(directPath)) return directPath;

  const normalizedTarget = normalizeFileName(fileName);
  const matchedFile = fs
    .readdirSync(importDir)
    .find((candidate) => normalizeFileName(candidate) === normalizedTarget);

  if (!matchedFile) {
    throw new Error(
      `${fileName} bulunamadı. Dosyayı ${importDir} klasörüne koyup tekrar çalıştırın.`,
    );
  }

  return path.join(importDir, matchedFile);
}

function readDormRows(filePath: string) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`${filePath} içinde okunabilir sayfa yok.`);

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  }) as unknown[][];

  const headerIndex = rawRows.findIndex(isHeaderRow);
  if (headerIndex === -1) {
    throw new Error(`${filePath} içinde beklenen Excel başlıkları bulunamadı.`);
  }

  const columns = getHeaderColumns(rawRows[headerIndex]);
  const rows: DormRow[] = [];
  const seenStudents = new Set<string>();

  for (const rawRow of rawRows.slice(headerIndex + 1)) {
    const fullName = cleanCell(rawRow[columns.fullName]);
    const groupName = cleanCell(rawRow[columns.groupName]);
    const teacherName =
      columns.teacherName === undefined
        ? ''
        : cleanCell(rawRow[columns.teacherName]);
    const studentNumber =
      columns.studentNumber === undefined
        ? null
        : cleanStudentNumber(rawRow[columns.studentNumber]);

    if (!fullName || !groupName) {
      summary.skippedRows += 1;
      continue;
    }

    const uniqueKey = studentNumber
      ? `number:${studentNumber}`
      : `name:${normalizeLookup(fullName)}`;

    if (seenStudents.has(uniqueKey)) {
      summary.skippedRows += 1;
      continue;
    }

    seenStudents.add(uniqueKey);
    rows.push({
      fullName,
      groupName,
      teacherName: teacherName || null,
      studentNumber,
    });
  }

  return rows;
}

function isHeaderRow(row: unknown[]) {
  const headers = new Set(row.map((cell) => normalizeLookup(cleanCell(cell))));
  return headers.has('GRUP') && headers.has('ADI SOYADI');
}

function getHeaderColumns(row: unknown[]): HeaderColumns {
  const indexByHeader = new Map<string, number>();
  row.forEach((cell, index) => {
    const header = normalizeLookup(cleanCell(cell));
    if (header) indexByHeader.set(header, index);
  });

  const columns: HeaderColumns = {
    studentNumber: pickColumn(indexByHeader, ['T.NO', 'T NO', 'TNO']),
    groupName: requireColumn(indexByHeader, ['GRUP']),
    teacherName: pickColumn(indexByHeader, ['GRUP MESULU', 'GRUP MESULÜ']),
    fullName: requireColumn(indexByHeader, ['ADI SOYADI', 'AD SOYAD']),
  };

  return columns;
}

function pickColumn(indexByHeader: Map<string, number>, names: string[]) {
  for (const name of names) {
    const index = indexByHeader.get(normalizeLookup(name));
    if (index !== undefined) return index;
  }
  return undefined;
}

function requireColumn(indexByHeader: Map<string, number>, names: string[]) {
  const index = pickColumn(indexByHeader, names);
  if (index === undefined) {
    throw new Error(`Zorunlu kolon bulunamadı: ${names.join(' / ')}`);
  }
  return index;
}

async function importDorm(
  dorm: DormImportConfig,
  rows: DormRow[],
  passwordHash: string,
) {
  const institution = await upsertInstitution(dorm);
  summary.importedInstitutions.add(institution.id);
  const groups = await upsertGroups(institution.id, rows);
  const groupNameById = new Map(
    [...groups.values()].map((group) => [group.id, group.name]),
  );
  const teacherGroups = new Map<string, Set<string>>();

  for (const row of rows) {
    const group = groups.get(normalizeLookup(row.groupName));
    if (!group) {
      summary.skippedRows += 1;
      continue;
    }

    await upsertStudent(institution.id, group.id, row);
    summary.importedStudents.add(
      `${institution.id}:${row.studentNumber ?? normalizeLookup(row.fullName)}`,
    );

    if (row.teacherName) {
      const teacherKey = normalizeLookup(row.teacherName);
      const groupIds = teacherGroups.get(teacherKey) ?? new Set<string>();
      groupIds.add(group.id);
      teacherGroups.set(teacherKey, groupIds);
    }
  }

  for (const [teacherKey, groupIds] of teacherGroups.entries()) {
    const teacherName = rows.find(
      (row) => row.teacherName && normalizeLookup(row.teacherName) === teacherKey,
    )?.teacherName;

    if (teacherName) {
      const assignments = [...groupIds].map((id) => ({
        id,
        name: groupNameById.get(id) ?? id,
      }));
      await upsertGroupResponsible(
        institution.id,
        dorm.institutionName,
        teacherName,
        assignments,
        passwordHash,
      );
    }
  }
}

async function upsertInstitution(dorm: DormImportConfig) {
  const existing = await prisma.institution.findFirst({
    where: { name: dorm.institutionName },
  });

  if (!existing) {
    summary.institutions.created += 1;
    return prisma.institution.create({
      data: {
        name: dorm.institutionName,
        city: 'İstanbul',
        district: dorm.district,
        isActive: true,
      },
    });
  }

  summary.institutions.updated += 1;
  return prisma.institution.update({
    where: { id: existing.id },
    data: {
      city: existing.city || 'İstanbul',
      district: existing.district || dorm.district,
      isActive: true,
    },
  });
}

async function upsertGroups(institutionId: string, rows: DormRow[]) {
  const groupInputs = new Map<string, { name: string; teacherNames: Set<string> }>();

  for (const row of rows) {
    const key = normalizeLookup(row.groupName);
    const input = groupInputs.get(key) ?? {
      name: row.groupName,
      teacherNames: new Set<string>(),
    };

    if (row.teacherName) input.teacherNames.add(row.teacherName);
    groupInputs.set(key, input);
  }

  const groups = new Map<string, { id: string; name: string }>();

  for (const [key, input] of groupInputs.entries()) {
    const teacherName = [...input.teacherNames].join(', ') || 'Belirtilmedi';
    const existing = await prisma.classGroup.findFirst({
      where: { institutionId, name: input.name },
    });

    if (!existing) {
      const created = await prisma.classGroup.create({
        data: {
          institutionId,
          name: input.name,
          teacherName,
          isActive: true,
        },
      });
      summary.groups.created += 1;
      summary.importedGroups.add(created.id);
      groups.set(key, created);
      continue;
    }

    const updated = await prisma.classGroup.update({
      where: { id: existing.id },
      data: {
        teacherName,
        isActive: true,
      },
    });
    summary.groups.updated += 1;
    summary.importedGroups.add(updated.id);
    groups.set(key, updated);
  }

  return groups;
}

async function upsertStudent(
  institutionId: string,
  classGroupId: string,
  row: DormRow,
) {
  const existingByNumber = row.studentNumber
    ? await prisma.student.findFirst({
        where: { institutionId, studentNumber: row.studentNumber },
      })
    : null;
  const existing =
    existingByNumber ??
    (await prisma.student.findFirst({
      where: { institutionId, fullName: row.fullName },
    }));

  if (!existing) {
    await prisma.student.create({
      data: {
        institutionId,
        classGroupId,
        fullName: row.fullName,
        studentNumber: row.studentNumber,
        isActive: true,
      },
    });
    summary.students.created += 1;
    return;
  }

  await prisma.student.update({
    where: { id: existing.id },
    data: {
      classGroupId,
      fullName: row.fullName,
      studentNumber: row.studentNumber ?? existing.studentNumber,
      isActive: true,
    },
  });
  summary.students.updated += 1;
}

async function upsertGroupResponsible(
  institutionId: string,
  institutionName: string,
  teacherName: string,
  groupAssignments: TeacherGroupAssignment[],
  passwordHash: string,
) {
  const email = `mesul.${slug(institutionName)}.${slug(teacherName)}@import.local`;
  const existing = await prisma.user.findUnique({ where: { email } });
  const assignedClassGroupIds = uniqueSorted(
    groupAssignments.map((group) => group.id),
  );

  if (!existing) {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: teacherName,
        globalRole: GlobalRole.GROUP_MANAGER,
        institutionId,
        institutionRole: InstitutionRole.RECORDER,
        assignedClassGroupIds,
        isActive: true,
      },
    });
    summary.groupResponsibles.created += 1;
    await linkTeacherToGroups(created.id, teacherName, assignedClassGroupIds);
    summary.importedTeachers.add(created.id);
    addTeacherAssignments(teacherName, institutionName, groupAssignments);
    return;
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      fullName: teacherName,
      globalRole: GlobalRole.GROUP_MANAGER,
      institutionId,
      institutionRole: InstitutionRole.RECORDER,
      assignedClassGroupIds: uniqueSorted([
        ...existing.assignedClassGroupIds,
        ...assignedClassGroupIds,
      ]),
      isActive: true,
    },
  });
  summary.groupResponsibles.updated += 1;
  await linkTeacherToGroups(updated.id, teacherName, assignedClassGroupIds);
  summary.importedTeachers.add(updated.id);
  addTeacherAssignments(teacherName, institutionName, groupAssignments);
}

async function linkTeacherToGroups(
  teacherUserId: string,
  teacherName: string,
  groupIds: string[],
) {
  await prisma.classGroup.updateMany({
    where: { id: { in: groupIds } },
    data: { teacherUserId, teacherName },
  });
}

function addTeacherAssignments(
  teacherName: string,
  institutionName: string,
  groupAssignments: TeacherGroupAssignment[],
) {
  for (const group of groupAssignments) {
    summary.teacherAssignments.push(
      `${teacherName} -> ${institutionName} / ${group.name}`,
    );
  }
}

function cleanCell(value: unknown) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') {
    const cell = value as { w?: unknown; v?: unknown };
    if (cell.w !== undefined) return cleanCell(cell.w);
    if (cell.v !== undefined) return cleanCell(cell.v);
    return '';
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  if (badCellValues.has(text.toUpperCase())) return '';
  return text;
}

function cleanStudentNumber(value: unknown) {
  const text = cleanCell(value);
  if (!text) return null;
  return text.replace(/\.0$/, '');
}

function normalizeLookup(value: string) {
  return value
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/İ/g, 'I')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFileName(fileName: string) {
  return normalizeLookup(fileName).replace(/\s+/g, '').replace(/[^A-Z0-9.]/g, '');
}

function slug(value: string) {
  const slugValue = normalizeLookup(value)
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

  return slugValue || 'kayit';
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function printSummary() {
  console.log('Dorm import tamamlandı.');
  console.log(`Kurum sayısı: ${summary.importedInstitutions.size}`);
  console.log(`Grup sayısı: ${summary.importedGroups.size}`);
  console.log(`Hoca / grup mesulü sayısı: ${summary.importedTeachers.size}`);
  console.log(`Öğrenci sayısı: ${summary.importedStudents.size}`);
  console.log(
    `Kurum: ${summary.institutions.created} eklendi, ${summary.institutions.updated} güncellendi`,
  );
  console.log(
    `Grup: ${summary.groups.created} eklendi, ${summary.groups.updated} güncellendi`,
  );
  console.log(
    `Öğrenci: ${summary.students.created} eklendi, ${summary.students.updated} güncellendi`,
  );
  console.log(
    `Grup mesulü: ${summary.groupResponsibles.created} eklendi, ${summary.groupResponsibles.updated} güncellendi`,
  );
  console.log(`Atlanan satır: ${summary.skippedRows}`);
  if (summary.teacherAssignments.length > 0) {
    console.log('Hoca-grup eşleşmeleri:');
    for (const assignment of summary.teacherAssignments) {
      console.log(`- ${assignment}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Dorm import başarısız: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
