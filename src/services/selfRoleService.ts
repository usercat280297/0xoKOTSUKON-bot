import type { DiscordTicketGateway } from "./discordGateway";

export interface SelfRoleContext {
  guildId: string;
  userId: string;
  memberRoleIds: string[];
  roleId: string;
}

export interface SelfRoleResponse {
  ok: boolean;
  message: string;
}

export class SelfRoleService {
  public constructor(private readonly gateway: DiscordTicketGateway) {}

  public async claimRole(input: SelfRoleContext): Promise<SelfRoleResponse> {
    if (input.memberRoleIds.includes(input.roleId)) {
      return {
        ok: false,
        message: `Bạn đã có role <@&${input.roleId}> rồi.`
      };
    }

    await this.gateway.addGuildMemberRole(input.guildId, input.userId, input.roleId, "Self role claim");
    return {
      ok: true,
      message: `Đã cấp role <@&${input.roleId}> cho bạn.`
    };
  }
}
