/**
 * The permission catalogue. Permissions are defined independently of roles
 * (§6): a role is only ever a named bundle of these keys, and every protected
 * route names the key it requires. Adding a permission here and re-running the
 * seed is the only way to introduce one.
 */
export interface PermissionDefinition {
  key: string;
  module: string;
  label: string;
  isSensitive?: boolean;
}

const define = (
  module: string,
  entries: Array<[key: string, label: string, sensitive?: boolean]>,
): PermissionDefinition[] =>
  entries.map(([key, label, isSensitive]) => ({
    key,
    module,
    label,
    isSensitive: Boolean(isSensitive),
  }));

export const PERMISSIONS: PermissionDefinition[] = [
  ...define('dashboard', [
    ['DASHBOARD_VIEW', 'Open the studio dashboard'],
    ['DASHBOARD_KPI', 'Show project KPI cards'],
    ['DASHBOARD_FINANCIAL', 'Show revenue, payments, expenses and payroll', true],
    ['DASHBOARD_UPCOMING', 'Show upcoming shoots'],
    ['DASHBOARD_PROJECTS', 'Show project deadlines'],
    ['DASHBOARD_TEAM', 'Show team activity'],
    ['DASHBOARD_TASKS', 'Show assigned tasks'],
    ['DASHBOARD_ATTENDANCE', 'Show my attendance'],
    ['DASHBOARD_TODOS', 'Show personal to-do'],
    ['DASHBOARD_QUICK_ACTIONS', 'Show quick actions'],
    ['DASHBOARD_ALERTS', 'Show studio alerts'],
  ]),
  ...define('organization', [
    ['ORG_VIEW', 'View organization profile'],
    ['ORG_UPDATE', 'Update organization profile', true],
  ]),
  ...define('branch', [
    ['BRANCH_VIEW', 'View branches'],
    ['BRANCH_CREATE', 'Create branch'],
    ['BRANCH_UPDATE', 'Update branch'],
    ['BRANCH_DELETE', 'Delete branch', true],
  ]),
  ...define('user', [
    ['USER_VIEW', 'View employee accounts'],
    ['USER_MANAGE', 'Assign roles and reset passwords', true],
  ]),
  ...define('role', [
    ['ROLE_VIEW', 'View roles'],
    ['ROLE_CREATE', 'Create role', true],
    ['ROLE_UPDATE', 'Update role', true],
    ['ROLE_DELETE', 'Delete role', true],
    ['PERMISSION_VIEW', 'View permission catalogue'],
    ['PERMISSION_ASSIGN', 'Grant or revoke permissions on a role', true],
  ]),
  ...define('lead', [
    ['LEAD_VIEW', 'View leads'],
    ['LEAD_CREATE', 'Create lead'],
    ['LEAD_UPDATE', 'Update lead'],
    ['LEAD_DELETE', 'Delete lead', true],
    ['LEAD_ASSIGN', 'Assign lead owner'],
    ['LEAD_CONVERT', 'Convert lead to client'],
  ]),
  ...define('client', [
    ['CLIENT_VIEW', 'View clients'],
    ['CLIENT_CREATE', 'Create client'],
    ['CLIENT_UPDATE', 'Update client'],
    ['CLIENT_DELETE', 'Delete client', true],
  ]),
  ...define('project', [
    ['PROJECT_VIEW', 'View projects'],
    ['PROJECT_CREATE', 'Create project'],
    ['PROJECT_UPDATE', 'Update project'],
    ['PROJECT_DELETE', 'Delete project', true],
    ['PROJECT_STATUS_CHANGE', 'Change project status'],
  ]),
  ...define('event', [
    ['EVENT_VIEW', 'View events'],
    ['EVENT_CREATE', 'Create event'],
    ['EVENT_UPDATE', 'Update event'],
    ['EVENT_DELETE', 'Delete event', true],
  ]),
  ...define('shoot', [
    ['SHOOT_VIEW', 'View shoots'],
    ['SHOOT_CREATE', 'Create shoot'],
    ['SHOOT_UPDATE', 'Update shoot'],
    ['SHOOT_DELETE', 'Delete shoot', true],
    ['SHOOT_ASSIGN', 'Assign crew to a shoot'],
  ]),
  ...define('team', [
    ['TEAM_VIEW', 'View team directory'],
    ['USER_CREATE', 'Create employee', true],
    ['USER_UPDATE', 'Edit employee', true],
    ['USER_DELETE', 'Delete employee', true],
    ['TEAM_MANAGE', 'Manage employee profiles', true],
  ]),
  ...define('freelancer', [
    ['FREELANCER_VIEW', 'View freelancers'],
    ['FREELANCER_CREATE', 'Create freelancer'],
    ['FREELANCER_UPDATE', 'Update freelancer'],
    ['FREELANCER_DELETE', 'Delete freelancer', true],
    ['FREELANCER_PAY', 'Record freelancer payout', true],
  ]),
  ...define('task', [
    ['TASK_VIEW', 'View tasks'],
    ['TASK_CREATE', 'Create task'],
    ['TASK_UPDATE', 'Update task'],
    ['TASK_DELETE', 'Delete task', true],
    ['TASK_ASSIGN', 'Assign or reassign a task'],
    ['PERSONAL_TODO', 'Manage own personal to-do list'],
  ]),
  ...define('attendance', [
    ['ATTENDANCE_VIEW', 'View attendance'],
    ['ATTENDANCE_MARK', 'Mark own attendance'],
    ['ATTENDANCE_MANAGE', 'Mark or edit attendance for others', true],
    ['LEAVE_VIEW', 'View leave requests'],
    ['LEAVE_REQUEST', 'Apply for leave'],
    ['LEAVE_APPROVE', 'Approve or reject leave', true],
  ]),
  ...define('quotation', [
    ['QUOTATION_VIEW', 'View quotations', true],
    ['QUOTATION_CREATE', 'Create quotation', true],
    ['QUOTATION_UPDATE', 'Update quotation', true],
    ['QUOTATION_DELETE', 'Delete quotation', true],
  ]),
  ...define('invoice', [
    ['INVOICE_VIEW', 'View invoices', true],
    ['INVOICE_CREATE', 'Create invoice', true],
    ['INVOICE_UPDATE', 'Update invoice', true],
    ['INVOICE_CANCEL', 'Cancel invoice', true],
  ]),
  ...define('payment', [
    ['PAYMENT_VIEW', 'View payments', true],
    ['PAYMENT_CREATE', 'Record payment', true],
    ['PAYMENT_UPDATE', 'Update payment metadata', true],
    ['PAYMENT_ALLOCATE', 'Allocate a payment across invoices', true],
  ]),
  ...define('expense', [
    ['EXPENSE_VIEW', 'View expenses', true],
    ['EXPENSE_CREATE', 'Create expense'],
    ['EXPENSE_UPDATE', 'Update expense'],
    ['EXPENSE_APPROVE', 'Approve or reject expense', true],
    ['EXPENSE_DELETE', 'Delete expense', true],
  ]),
  ...define('delivery', [
    ['DELIVERY_VIEW', 'View deliveries'],
    ['DELIVERY_CREATE', 'Create delivery'],
    ['DELIVERY_UPDATE', 'Update delivery'],
    ['DELIVERY_DELETE', 'Delete delivery', true],
  ]),
  ...define('file', [
    ['FILE_VIEW', 'View files'],
    ['FILE_UPLOAD', 'Register an uploaded file'],
    ['FILE_DELETE', 'Delete file', true],
  ]),
  ...define('notification', [['NOTIFICATION_VIEW', 'View own notifications']]),
  ...define('report', [
    ['REPORT_VIEW', 'View reports', true],
    ['REPORT_EXPORT', 'Export report data', true],
    ['DATA_MANAGEMENT_VIEW', 'View the data management overview'],
  ]),
  ...define('audit', [['AUDIT_VIEW', 'View audit log', true]]),
  ...define('setting', [
    ['SETTING_VIEW', 'View settings'],
    ['SETTING_UPDATE', 'Update settings', true],
  ]),
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SYSTEM_ROLES = ['ADMIN', 'MANAGER', 'MEMBER'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

const MANAGER_EXCLUDED = new Set([
  'ORG_UPDATE',
  'USER_DELETE',
  'ROLE_CREATE',
  'ROLE_UPDATE',
  'ROLE_DELETE',
  'PERMISSION_ASSIGN',
  'BRANCH_DELETE',
  'AUDIT_VIEW',
  'SETTING_UPDATE',
]);

const MEMBER_ALLOWED = new Set([
  'ORG_VIEW',
  'BRANCH_VIEW',
  'USER_VIEW',
  'LEAD_VIEW',
  'CLIENT_VIEW',
  'PROJECT_VIEW',
  'EVENT_VIEW',
  'SHOOT_VIEW',
  'TEAM_VIEW',
  'FREELANCER_VIEW',
  'TASK_VIEW',
  'TASK_UPDATE',
  'PERSONAL_TODO',
  'DASHBOARD_VIEW',
  'DASHBOARD_KPI',
  'DASHBOARD_UPCOMING',
  'DASHBOARD_PROJECTS',
  'DASHBOARD_TASKS',
  'DASHBOARD_ATTENDANCE',
  'DASHBOARD_TODOS',
  'ATTENDANCE_VIEW',
  'ATTENDANCE_MARK',
  'LEAVE_VIEW',
  'LEAVE_REQUEST',
  'EXPENSE_CREATE',
  'DELIVERY_VIEW',
  'DELIVERY_UPDATE',
  'FILE_VIEW',
  'FILE_UPLOAD',
  'NOTIFICATION_VIEW',
  'SETTING_VIEW',
  'DATA_MANAGEMENT_VIEW',
]);

/** Every role keeps these keys — they cannot be revoked from the Roles UI. */
export const ALWAYS_GRANTED_KEYS = ['NOTIFICATION_VIEW'] as const;

export function withAlwaysGranted(keys: string[]): string[] {
  return [...new Set([...keys, ...ALWAYS_GRANTED_KEYS])];
}

/** Default permission bundle for each seeded system role. */
export function permissionsForSystemRole(role: SystemRole): string[] {
  switch (role) {
    case 'ADMIN':
      return [...PERMISSION_KEYS];
    case 'MANAGER':
      return PERMISSION_KEYS.filter((key) => !MANAGER_EXCLUDED.has(key));
    case 'MEMBER':
      return PERMISSION_KEYS.filter((key) => MEMBER_ALLOWED.has(key));
  }
}
