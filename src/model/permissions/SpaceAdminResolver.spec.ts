import { describe, it, expect, vi, beforeEach } from 'vitest';
import SpaceAdminResolver, { type SpaceAdminResolverRequestAdapter } from './SpaceAdminResolver';

describe('SpaceAdminResolver', () => {
  let requestAdapter: SpaceAdminResolverRequestAdapter;
  let resolver: SpaceAdminResolver;

  beforeEach(() => {
    requestAdapter = {
      request: vi.fn(),
      requestAllPaginatedData: vi.fn(),
    };
    resolver = new SpaceAdminResolver(requestAdapter);
  });

  it('should resolve user, group, and role space admins to users', async () => {
    vi.mocked(requestAdapter.request)
      .mockResolvedValueOnce({ results: [{ id: '789', key: 'ENG' }] })
      .mockResolvedValueOnce({
        results: [
          { accountId: 'user-1', displayName: 'Alice Admin', publicName: 'Alice' },
          { accountId: 'user-2', displayName: 'Bob Builder', publicName: 'Bob' },
          { accountId: 'user-3', displayName: 'Cara Curator', publicName: 'Cara' },
        ],
      });

    vi.mocked(requestAdapter.requestAllPaginatedData).mockImplementation(async (initialUrl, consumer) => {
      switch (initialUrl) {
        case '/api/v2/spaces/789/permissions':
          consumer({
            results: [
              { principal: { type: 'user', id: 'user-1' }, operation: { key: 'administer', targetType: 'space' } },
              { principal: { type: 'group', id: 'group-1' }, operation: { key: 'administer', targetType: 'space' } },
              { principal: { type: 'role', id: 'role-1' }, operation: { key: 'administer', targetType: 'space' } },
              { principal: { type: 'user', id: 'user-2' }, operation: { key: 'read', targetType: 'space' } },
            ],
          });
          return;
        case '/rest/api/group/group-1/membersByGroupId':
          consumer({
            results: [
              { accountId: 'user-2' },
              { accountId: 'user-3' },
            ],
          });
          return;
        case '/api/v2/spaces/789/role-assignments?role-id=role-1':
          consumer({
            results: [
              { principal: { principalType: 'USER', principalId: 'user-3' }, roleId: 'role-1' },
              { principal: { principalType: 'GROUP', principalId: 'group-1' }, roleId: 'role-1' },
            ],
          });
          return;
        default:
          throw new Error(`Unexpected paginated request: ${initialUrl}`);
      }
    });

    await expect(resolver.getSpaceAdmins({ key: 'ENG' })).resolves.toEqual([
      { type: 'user', id: 'user-1', displayName: 'Alice Admin' },
      { type: 'user', id: 'user-2', displayName: 'Bob Builder' },
      { type: 'user', id: 'user-3', displayName: 'Cara Curator' },
    ]);

    expect(requestAdapter.request).toHaveBeenNthCalledWith(
      1,
      '/api/v2/spaces?keys=ENG'
    );
    expect(requestAdapter.request).toHaveBeenNthCalledWith(
      2,
      '/api/v2/users-bulk',
      'POST',
      { accountIds: ['user-1', 'user-2', 'user-3'] }
    );
  });
});
