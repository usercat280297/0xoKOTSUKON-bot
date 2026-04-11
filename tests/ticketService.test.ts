import { beforeEach, describe, expect, it } from "vitest";
import type { TicketPanelWithOptions } from "../src/domain/types";
import { BusinessHoursService } from "../src/services/businessHoursService";
import { PermissionService } from "../src/services/permissionService";
import { TicketService } from "../src/services/ticketService";
import { TranscriptService } from "../src/services/transcriptService";
import {
  FakeDiscordGateway,
  FakeGuildConfigRepository,
  FakePanelRepository,
  FakeSteamActivationScreenshotAnalyzer,
  FakeTicketRepository
} from "./fakes/fakeRepositories";

function makePanel(): TicketPanelWithOptions {
  return {
    id: "panel-1",
    guildId: "guild-1",
    name: "Main Support",
    channelId: "panel-channel",
    messageId: null,
    messageIds: [],
    placeholder: "Choose a route",
    template: "default",
    active: true,
    options: [
      {
        id: "option-1",
        panelId: "panel-1",
        value: "billing",
        label: "Billing",
        emoji: null,
        boardSection: null,
        stockRemaining: null,
        stockTotal: null,
        sortOrder: 1,
        requiredRoleId: "verified-role",
        redirectChannelId: "role-channel",
        targetCategoryId: "billing-category",
        staffRoleId: "billing-staff",
        active: true
      },
      {
        id: "option-2",
        panelId: "panel-1",
        value: "vip",
        label: "VIP",
        emoji: null,
        boardSection: null,
        stockRemaining: null,
        stockTotal: null,
        sortOrder: 2,
        requiredRoleId: "vip-role",
        redirectChannelId: "vip-role-channel",
        targetCategoryId: "vip-category",
        staffRoleId: "vip-staff",
        active: true
      }
    ]
  };
}

function makeSteamPanel(): TicketPanelWithOptions {
  return {
    id: "panel-steam",
    guildId: "guild-1",
    name: "STEAM ACTIVATION",
    channelId: "steam-panel-channel",
    messageId: null,
    messageIds: [],
    placeholder: "Choose a game",
    template: "game-activation",
    active: true,
    options: [
      {
        id: "steam-option-1",
        panelId: "panel-steam",
        value: "resident-evil-requiem",
        label: "Resident Evil Requiem",
        emoji: null,
        boardSection: "Steam (H-Z)",
        stockRemaining: 1,
        stockTotal: 1,
        sortOrder: 1,
        requiredRoleId: "gamers-role",
        redirectChannelId: "role-channel",
        targetCategoryId: "steam-category",
        staffRoleId: "steam-staff",
        active: true
      }
    ]
  };
}

describe("TicketService", () => {
  let guildConfigs: FakeGuildConfigRepository;
  let panels: FakePanelRepository;
  let tickets: FakeTicketRepository;
  let gateway: FakeDiscordGateway;
  let screenshots: FakeSteamActivationScreenshotAnalyzer;
  let service: TicketService;

  beforeEach(() => {
    guildConfigs = new FakeGuildConfigRepository();
    panels = new FakePanelRepository();
    tickets = new FakeTicketRepository();
    gateway = new FakeDiscordGateway();
    screenshots = new FakeSteamActivationScreenshotAnalyzer();
    panels.seedPanel(makePanel());
    panels.seedPanel(makeSteamPanel());

    service = new TicketService(
      guildConfigs,
      panels,
      tickets,
      gateway,
      new PermissionService(),
      new TranscriptService(),
      new BusinessHoursService(
        {
          timezone: "Asia/Bangkok",
          startHour: 21,
          endHour: 24
        },
        () => new Date("2026-04-10T14:30:00.000Z")
      ),
      screenshots
    );
  });

  it("creates a ticket in the mapped category and staff route", async () => {
    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-1",
      optionValue: "vip",
      userId: "user-1",
      memberRoleIds: ["vip-role"],
      displayName: "Alice"
    });

    expect(result.ok).toBe(true);
    expect(gateway.createdChannels).toHaveLength(1);
    expect(gateway.createdChannels[0]).toMatchObject({
      targetCategoryId: "vip-category",
      staffRoleId: "vip-staff",
      requesterId: "user-1"
    });
    expect(gateway.introMessages[0]).toMatchObject({
      panelName: "Main Support",
      optionLabel: "VIP"
    });
    expect([...tickets.tickets.values()]).toHaveLength(1);
  });

  it("lets the requester choose a quick issue detail inside the ticket", async () => {
    tickets.seedTicket({
      id: "ticket-1",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "ticket-channel",
      optionId: "option-1",
      status: "open",
      originalCategoryId: "billing-category",
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    const result = await service.selectIssueByTicketId("ticket-1", "activation-help", "user-1");

    expect(result.ok).toBe(true);
    expect(gateway.issueUpdates).toEqual([
      {
        channelId: "ticket-channel",
        ticketId: "ticket-1",
        issueValue: "activation-help",
        issueLabel: "Cần kích hoạt game"
      }
    ]);
  });

  it("returns an ephemeral-style denial message when the member lacks the required role", async () => {
    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-1",
      optionValue: "billing",
      userId: "user-1",
      memberRoleIds: [],
      displayName: "Alice"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("<#role-channel>");
    expect(gateway.createdChannels).toHaveLength(0);
  });

  it("blocks a second open ticket for the same user", async () => {
    tickets.seedTicket({
      id: "ticket-1",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "channel-open",
      optionId: "option-1",
      status: "open",
      originalCategoryId: "billing-category",
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-1",
      optionValue: "billing",
      userId: "user-1",
      memberRoleIds: ["verified-role"],
      displayName: "Alice"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("<#channel-open>");
    expect(gateway.createdChannels).toHaveLength(0);
  });

  it("blocks ticket creation outside the configured hours", async () => {
    const serviceOutsideHours = new TicketService(
      guildConfigs,
      panels,
      tickets,
      gateway,
      new PermissionService(),
      new TranscriptService(),
      new BusinessHoursService(
        {
          timezone: "Asia/Bangkok",
          startHour: 21,
          endHour: 24
        },
        () => new Date("2026-04-10T10:00:00.000Z")
      ),
      screenshots
    );

    const result = await serviceOutsideHours.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-1",
      optionValue: "billing",
      userId: "user-1",
      memberRoleIds: ["verified-role"],
      displayName: "Alice"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("21:00-24:00");
    expect(gateway.createdChannels).toHaveLength(0);
  });

  it("claims and closes a ticket by sending the transcript then deleting the channel", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: "log-channel",
      closedCategoryId: "closed-category"
    };
    gateway.transcriptMessages = [
      {
        id: "msg-1",
        authorId: "user-1",
        authorTag: "user#0001",
        avatarUrl: null,
        content: "Help me",
        createdAt: new Date("2026-04-10T00:00:00.000Z"),
        attachments: []
      }
    ];
    tickets.seedTicket({
      id: "ticket-1",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "ticket-channel",
      optionId: "option-1",
      status: "open",
      originalCategoryId: "billing-category",
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    const claimResult = await service.claimByChannelId("ticket-channel", {
      actorId: "staff-1",
      actorRoleIds: ["billing-staff"],
      hasManageChannels: false
    });
    expect(claimResult.ok).toBe(true);
    expect(gateway.claimUpdates[0]).toMatchObject({
      channelId: "ticket-channel",
      ticketId: "ticket-1",
      claimedBy: "staff-1"
    });

    const closeResult = await service.closeByChannelId("ticket-channel", {
      actorId: "staff-1",
      actorRoleIds: ["billing-staff"],
      hasManageChannels: false
    });
    expect(closeResult.ok).toBe(true);
    expect(gateway.logMessages).toHaveLength(1);
    expect(gateway.deletedChannels).toEqual(["ticket-channel"]);
    expect((await tickets.findById("ticket-1"))?.status).toBe("closed");

    const reopenResult = await service.reopenByChannelId("ticket-channel", {
      actorId: "staff-1",
      actorRoleIds: ["billing-staff"],
      hasManageChannels: false
    });
    expect(reopenResult.ok).toBe(false);
    expect(reopenResult.message).toContain("không thể reopen");
  });

  it("prompts for screenshot after claiming a steam activation ticket and validates the upload", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    const claimResult = await service.claimByChannelId("steam-ticket-channel", {
      actorId: "staff-1",
      actorRoleIds: ["steam-staff"],
      hasManageChannels: false
    });

    expect(claimResult.ok).toBe(true);
    expect(gateway.channelMessages.at(-1)?.content).toContain("gửi 1 ảnh màn hình giống mẫu");

    await service.handleIncomingTicketMessage({
      channelId: "steam-ticket-channel",
      authorId: "user-1",
      attachments: [
        {
          name: "proof.webp",
          url: "https://example.com/proof.webp",
          contentType: "image/webp"
        }
      ]
    });

    expect(screenshots.seenUrls).toEqual(["https://example.com/proof.webp"]);
    expect(gateway.channelMessages.at(-1)?.content).toContain("Ảnh xác minh đã qua kiểm tra sơ bộ.");
  });
});
