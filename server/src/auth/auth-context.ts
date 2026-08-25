import { prisma } from '../db';
import { HR_ROLE_CODES, ROLES, type RoleCode } from '../domain/constants';
import { UnauthenticatedError } from '../domain/errors';

/**
 * Istek basina kimlik baglami.
 * Roller her istekte veritabanindan okunur; boylece rol/pasiflik degisiklikleri
 * eski token ile atlatilamaz.
 */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  department: string | null;
  departmentCode: string | null;
  title: string | null;
  managerId: string | null;
  roles: RoleCode[];
  groupIds: string[];
}

export async function loadAuthUser(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: true, groups: { select: { groupId: true } } },
  });

  if (!user || !user.isActive) {
    throw new UnauthenticatedError('Kullanici bulunamadi veya pasif durumda.');
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    department: user.department,
    departmentCode: user.departmentCode,
    title: user.title,
    managerId: user.managerId,
    roles: user.roles.map((r) => r.roleCode as RoleCode),
    groupIds: user.groups.map((g) => g.groupId),
  };
}

export function hasRole(user: AuthUser, ...roles: RoleCode[]): boolean {
  return roles.some((role) => user.roles.includes(role));
}

export function isAdmin(user: AuthUser): boolean {
  return user.roles.includes(ROLES.ADMIN);
}

export function isHr(user: AuthUser): boolean {
  return HR_ROLE_CODES.some((role) => user.roles.includes(role));
}
