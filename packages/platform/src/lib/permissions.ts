export const TEAM_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** What a person can ask the platform to do. The table below is the single place that says who may. */
export type Action =
  | 'site.read'
  | 'analytics.read'
  | 'site.edit'
  | 'site.build'
  | 'site.manage'
  | 'agent.manage'
  | 'keys.manage'
  | 'members.manage'
  | 'team.delete';

const MINIMUM: Record<Action, TeamRole> = {
  'site.read': 'viewer',
  'analytics.read': 'viewer',
  'site.edit': 'editor',
  'site.build': 'editor',
  'site.manage': 'admin',
  'agent.manage': 'admin',
  'keys.manage': 'admin',
  'members.manage': 'admin',
  'team.delete': 'owner',
};

export const rank = (role: TeamRole): number => TEAM_ROLES.indexOf(role);

export const isTeamRole = (value: unknown): value is TeamRole =>
  typeof value === 'string' &&
  (TEAM_ROLES as readonly string[]).includes(value);

/** Roles are cumulative: an admin can do everything an editor can. */
export function can(role: TeamRole | undefined, action: Action): boolean {
  return role !== undefined && rank(role) >= rank(MINIMUM[action]);
}
