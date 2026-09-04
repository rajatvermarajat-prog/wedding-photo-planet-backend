/**
 * The Settings workspace catalogue: the modules an employee can ask for, and
 * the notification switches the preferences screen renders.
 *
 * A "module" is not a new authorization concept. It is a named bundle of keys
 * that already exist in `PERMISSIONS` (§6), so approving a request writes to
 * the same `role_permissions` rows the Roles & Permissions desk edits. Adding a
 * module here can therefore never grant authority the catalogue does not
 * already define — `assertCatalogueIsSound` fails the boot if it tries.
 */
import { PERMISSION_KEYS } from './permissions';

export interface SettingsModuleDefinition {
  key: string;
  label: string;
  description: string;
  /** Granted verbatim on approval. Read access only — never a delete or an
   *  approval right, both of which stay a deliberate Roles-desk decision. */
  permissionKeys: string[];
}

export const SETTINGS_MODULES: SettingsModuleDefinition[] = [
  {
    key: 'leads',
    label: 'Leads',
    description: 'See the enquiry pipeline and follow-ups.',
    permissionKeys: ['LEAD_VIEW'],
  },
  {
    key: 'clients',
    label: 'Clients',
    description: 'See the client directory and their history.',
    permissionKeys: ['CLIENT_VIEW'],
  },
  {
    key: 'projects',
    label: 'Projects',
    description: 'See wedding projects and their timelines.',
    permissionKeys: ['PROJECT_VIEW'],
  },
  {
    key: 'shoots',
    label: 'Shoot Management',
    description: 'See scheduled shoots, events and crew calls.',
    permissionKeys: ['SHOOT_VIEW', 'EVENT_VIEW'],
  },
  {
    key: 'finance',
    label: 'Finance',
    description: 'See quotations, invoices, payments and expenses.',
    permissionKeys: ['QUOTATION_VIEW', 'INVOICE_VIEW', 'PAYMENT_VIEW', 'EXPENSE_VIEW'],
  },
  {
    key: 'tasks',
    label: 'Tasks',
    description: 'See the studio task board.',
    permissionKeys: ['TASK_VIEW'],
  },
  {
    key: 'team',
    label: 'Team',
    description: 'See the employee directory.',
    permissionKeys: ['TEAM_VIEW'],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'See attendance records and leave requests.',
    permissionKeys: ['ATTENDANCE_VIEW', 'LEAVE_VIEW'],
  },
  {
    key: 'deliveries',
    label: 'Deliveries',
    description: 'See album, print and digital delivery status.',
    permissionKeys: ['DELIVERY_VIEW'],
  },
  {
    key: 'freelancers',
    label: 'Freelancers',
    description: 'See the freelancer roster and their bookings.',
    permissionKeys: ['FREELANCER_VIEW'],
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'See studio reports and exports.',
    permissionKeys: ['REPORT_VIEW'],
  },
  {
    key: 'data-management',
    label: 'Data Management',
    description: 'See the per-project data backup overview.',
    permissionKeys: ['DATA_MANAGEMENT_VIEW'],
  },
  {
    key: 'files',
    label: 'Files',
    description: 'See files attached across the studio.',
    permissionKeys: ['FILE_VIEW'],
  },
];

const MODULES_BY_KEY = new Map(SETTINGS_MODULES.map((module) => [module.key, module]));

export const SETTINGS_MODULE_KEYS = SETTINGS_MODULES.map((module) => module.key);

export const findSettingsModule = (key: string): SettingsModuleDefinition | undefined =>
  MODULES_BY_KEY.get(key);

/**
 * Fails loudly if a module names a permission the catalogue does not define.
 * Without this, a typo would silently produce a module that grants nothing and
 * an approval that appears to succeed while changing no access at all.
 */
export function assertCatalogueIsSound(): void {
  const known = new Set(PERMISSION_KEYS);
  const unknown = SETTINGS_MODULES.flatMap((module) =>
    module.permissionKeys.filter((key) => !known.has(key)).map((key) => `${module.key}:${key}`),
  );
  if (unknown.length > 0) {
    throw new Error(`Settings module catalogue names unknown permissions: ${unknown.join(', ')}`);
  }
}

assertCatalogueIsSound();

/**
 * The notification switches shown on the preferences screen, with the state a
 * brand-new employee starts from. Stored per user as `jsonb`, so removing a
 * switch here simply stops rendering it — no migration, no orphan column.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<string, boolean> = {
  shootAssigned: true,
  shootReminder: true,
  taskAssigned: true,
  taskCompleted: false,
  paymentReceived: false,
  invoiceOverdue: false,
  expenseDecision: true,
  deliveryReady: true,
  leadAssigned: true,
  projectStatusChanged: false,
  systemAlerts: true,
  emailDigest: false,
};

export interface SecurityPreferences {
  sessionTimeoutMinutes?: number;
  notifyNewLogin?: boolean;
}

export const DEFAULT_SECURITY_PREFERENCES: SecurityPreferences = {
  sessionTimeoutMinutes: 60,
  notifyNewLogin: true,
};
