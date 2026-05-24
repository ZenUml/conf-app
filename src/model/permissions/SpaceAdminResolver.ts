import type { ISpace } from '@/model/ILocationContext';
import type { SpaceAdmin } from '@/model/SpaceAdmin';

interface SpacePermissionAssignment {
  principal?: {
    type?: string;
    id?: string;
    principalType?: string;
    principalId?: string;
  };
  operation?: {
    key?: string;
    targetType?: string;
    target?: string;
  };
}

interface SpaceRoleAssignment {
  principal?: {
    principalType?: string;
    principalId?: string;
    type?: string;
    id?: string;
  };
  roleId?: string;
}

interface ConfluenceUserSummary {
  accountId: string;
  displayName?: string;
  publicName?: string;
}

type Principal = { type: 'user' | 'group' | 'role'; id: string };

export interface SpaceAdminResolverRequestAdapter {
  request(url: string, type?: string, data?: any): Promise<any>;
  requestAllPaginatedData(initialUrl: string, consumer: (data: any) => void): Promise<any>;
}

export default class SpaceAdminResolver {
  private readonly cache = new Map<string, SpaceAdmin[]>();

  constructor(private readonly requestAdapter: SpaceAdminResolverRequestAdapter) {}

  async getSpaceAdmins(space: ISpace): Promise<SpaceAdmin[]> {
    const cached = this.cache.get(space.key) || (space.id ? this.cache.get(String(space.id)) : undefined);
    if (cached) {
      return cached;
    }

    const spaceId = await this.resolveSpaceId(space);
    const assignments: SpacePermissionAssignment[] = [];

    await this.requestAdapter.requestAllPaginatedData(`/api/v2/spaces/${spaceId}/permissions`, (data) => {
      assignments.push(...(data?.results || []));
    });

    const adminAssignments = assignments.filter((assignment) => {
      const targetType = assignment.operation?.targetType || assignment.operation?.target;
      return assignment.operation?.key === 'administer' && targetType === 'space';
    });

    const resolvedUserIds = await Promise.all(
      adminAssignments.map((assignment) => this.resolvePrincipalToUsers(
        spaceId,
        this.getPrincipalTypeAndId(assignment)
      ))
    );
    const userIds = [...new Set(resolvedUserIds.flat())];
    const usersById = await this.fetchUsersByAccountId(userIds);

    const admins = userIds.map((userId) => ({
      type: 'user' as const,
      id: userId,
      displayName: usersById.get(userId)?.displayName || usersById.get(userId)?.publicName || userId,
    }));

    this.cache.set(space.key, admins);
    this.cache.set(spaceId, admins);
    return admins;
  }

  private async resolveSpaceId(space: ISpace): Promise<string> {
    if (space.id) {
      return String(space.id);
    }

    const response = await this.requestAdapter.request(`/api/v2/spaces?keys=${encodeURIComponent(space.key)}`);
    const spaceId = response?.results?.[0]?.id;

    if (!spaceId) {
      throw new Error(`Unable to resolve current space id for key "${space.key}"`);
    }

    space.id = String(spaceId);
    return String(spaceId);
  }

  private getPrincipalTypeAndId(
    assignment: SpacePermissionAssignment | SpaceRoleAssignment
  ): Principal | undefined {
    const rawType = assignment.principal?.type || assignment.principal?.principalType;
    const id = assignment.principal?.id || assignment.principal?.principalId;

    if (!rawType || !id) {
      return undefined;
    }

    const type = rawType.toLowerCase();
    if (type !== 'user' && type !== 'group' && type !== 'role') {
      return undefined;
    }

    return { type, id };
  }

  private async resolvePrincipalToUsers(
    spaceId: string,
    principal: Principal | undefined,
    visited: Set<string> = new Set()
  ): Promise<string[]> {
    if (!principal) {
      return [];
    }

    const visitKey = `${principal.type}:${principal.id}`;
    if (visited.has(visitKey)) {
      return [];
    }
    visited.add(visitKey);

    if (principal.type === 'user') {
      return [principal.id];
    }

    if (principal.type === 'group') {
      return this.getGroupMemberAccountIds(principal.id);
    }

    const assignments: SpaceRoleAssignment[] = [];
    await this.requestAdapter.requestAllPaginatedData(
      `/api/v2/spaces/${spaceId}/role-assignments?role-id=${encodeURIComponent(principal.id)}`,
      (data) => {
        assignments.push(...(data?.results || []));
      }
    );

    const resolved = await Promise.all(
      assignments.map((assignment) => this.resolvePrincipalToUsers(
        spaceId,
        this.getPrincipalTypeAndId(assignment),
        new Set(visited)
      ))
    );

    return [...new Set(resolved.flat())];
  }

  private async getGroupMemberAccountIds(groupId: string): Promise<string[]> {
    const members: Array<{ accountId?: string }> = [];
    await this.requestAdapter.requestAllPaginatedData(
      `/rest/api/group/${encodeURIComponent(groupId)}/membersByGroupId`,
      (data) => {
        members.push(...(data?.results || []));
      }
    );

    return [...new Set(
      members
        .map((member) => member.accountId)
        .filter((accountId): accountId is string => Boolean(accountId))
    )];
  }

  private async fetchUsersByAccountId(accountIds: string[]): Promise<Map<string, ConfluenceUserSummary>> {
    if (!accountIds.length) {
      return new Map();
    }

    const response = await this.requestAdapter.request('/api/v2/users-bulk', 'POST', { accountIds });
    const users = response?.results || [];
    return new Map(users.map((user: ConfluenceUserSummary) => [user.accountId, user]));
  }
}
