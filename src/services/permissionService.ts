export class PermissionService {
  public hasRequiredRole(memberRoleIds: readonly string[], requiredRoleId: string): boolean {
    return memberRoleIds.includes(requiredRoleId);
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
