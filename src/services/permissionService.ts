export class PermissionService {
  public hasRequiredRole(
    memberRoleIds: readonly string[],
    requiredRoleId: string,
    extraAllowedRoleIds: readonly string[] = []
  ): boolean {
    return memberRoleIds.includes(requiredRoleId) || extraAllowedRoleIds.some((roleId) => memberRoleIds.includes(roleId));
  }

  public isStaff(actorRoleIds: readonly string[], staffRoleId: string, hasManageChannels: boolean): boolean {
    return hasManageChannels || actorRoleIds.includes(staffRoleId);
  }

  public canCloseTicket(
    actorId: string,
    requesterId: string,
    actorRoleIds: readonly string[],
    staffRoleId: string,
    hasManageChannels: boolean
  ): boolean {
    return actorId === requesterId || this.isStaff(actorRoleIds, staffRoleId, hasManageChannels);
  }
}
