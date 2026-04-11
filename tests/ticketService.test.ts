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

function makeDonationPanel(): TicketPanelWithOptions {
  return {
    id: "panel-donation",
    guildId: "guild-1",
    name: "DONATE",
    channelId: "donate-panel-channel",
    messageId: null,
    messageIds: [],
    placeholder: "Open a donation ticket",
    template: "donation",
    active: true,
    options: [
      {
        id: "donation-option-1",
        panelId: "panel-donation",
        value: "donate",
        label: "Donate",
        emoji: null,
        boardSection: null,
        stockRemaining: null,
        stockTotal: null,
        sortOrder: 1,
        requiredRoleId: "verified-role",
        redirectChannelId: "role-channel",
        targetCategoryId: "donate-category",
        staffRoleId: "donation-staff",
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
    panels.seedPanel(makeDonationPanel());

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

  it("returns an denial message when the member lacks the required role", async () => {
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

  it("allows donation tickets outside the configured hours", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: null,
      closedCategoryId: null,
      donatorRoleId: "donator-role",
      donationThanksChannelId: "thanks-channel",
      donationLinkUrl: "https://ko-fi.com/example",
      donationQrImageUrl: "https://cdn.example.com/qr.png"
    };

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
      panelId: "panel-donation",
      optionValue: "donate",
      userId: "user-1",
      memberRoleIds: ["verified-role"],
      displayName: "Alice"
    });

    expect(result.ok).toBe(true);
    expect(gateway.createdChannels.at(-1)?.targetCategoryId).toBe("donate-category");
  });

  it("claims and closes a ticket by sending the transcript then deleting the channel", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: "log-channel",
      closedCategoryId: "closed-category",
      donatorRoleId: null,
      donationThanksChannelId: null,
      donationLinkUrl: null,
      donationQrImageUrl: null
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
    expect(gateway.channelMessages.at(-1)?.content).toContain("20 phút");

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
    expect(gateway.channelMessages.at(-1)?.content).toBe("Đang xác minh ảnh...");
    expect(gateway.verificationPrompts).toEqual([
      {
        channelId: "steam-ticket-channel",
        ticketId: "ticket-steam"
      }
    ]);
  });

  it("allows DONATOR members to open steam activation tickets", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: null,
      closedCategoryId: null,
      donatorRoleId: "donator-role",
      donationThanksChannelId: null,
      donationLinkUrl: null,
      donationQrImageUrl: null
    };

    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-steam",
      optionValue: "resident-evil-requiem",
      userId: "user-9",
      memberRoleIds: ["donator-role"],
      displayName: "Bob"
    });

    expect(result.ok).toBe(true);
    expect(gateway.createdChannels[0]).toMatchObject({
      targetCategoryId: "steam-category",
      staffRoleId: "steam-staff"
    });
  });

  it("creates a donation ticket and sends the donate prompt", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: null,
      closedCategoryId: null,
      donatorRoleId: "donator-role",
      donationThanksChannelId: "thanks-channel",
      donationLinkUrl: "https://buymeacoffee.com/example",
      donationQrImageUrl: "https://cdn.example.com/qr.png",
      donationAllowedRoleIds: []
    };

    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-donation",
      optionValue: "donate",
      userId: "user-1",
      memberRoleIds: ["verified-role"],
      displayName: "Alice"
    });

    expect(result.ok).toBe(true);
    expect(gateway.donationPrompts).toEqual([
      {
        channelId: "channel-1",
        ticketId: expect.any(String),
        donationLinkUrl: "https://buymeacoffee.com/example",
        donationQrImageUrl: "https://cdn.example.com/qr.png"
      }
    ]);
  });

  it("allows donation tickets for configured bypass roles", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: null,
      closedCategoryId: null,
      donatorRoleId: "donator-role",
      donationThanksChannelId: "thanks-channel",
      donationLinkUrl: "https://buymeacoffee.com/example",
      donationQrImageUrl: "https://cdn.example.com/qr.png",
      donationAllowedRoleIds: ["gamers-role", "booster-role", "donator-role"]
    };

    const result = await service.createFromSelection({
      guildId: "guild-1",
      panelId: "panel-donation",
      optionValue: "donate",
      userId: "user-2",
      memberRoleIds: ["booster-role"],
      displayName: "Boosted Alice"
    });

    expect(result.ok).toBe(true);
    expect(gateway.createdChannels.at(-1)).toMatchObject({
      targetCategoryId: "donate-category",
      staffRoleId: "donation-staff",
      requesterId: "user-2"
    });
  });

  it("falls back to the live guild donation access roles when no extra config is stored", async () => {
    const liveDonationPanel = {
      ...makeDonationPanel(),
      id: "panel-donation-live",
      guildId: "1492076309323714570",
      options: [
        {
          ...makeDonationPanel().options[0],
          id: "donation-option-live",
          panelId: "panel-donation-live"
        }
      ]
    };
    panels.seedPanel(liveDonationPanel);

    const result = await service.createFromSelection({
      guildId: "1492076309323714570",
      panelId: "panel-donation-live",
      optionValue: "donate",
      userId: "user-3",
      memberRoleIds: ["1492131096937238588"],
      displayName: "Boosted Bob"
    });

    expect(result.ok).toBe(true);
    expect(gateway.createdChannels.at(-1)).toMatchObject({
      targetCategoryId: "donate-category",
      staffRoleId: "donation-staff",
      requesterId: "user-3"
    });
  });

  it("records donation proof and lets admin approve it", async () => {
    guildConfigs.current = {
      guildId: "guild-1",
      logChannelId: null,
      closedCategoryId: null,
      donatorRoleId: "donator-role",
      donationThanksChannelId: "thanks-channel",
      donationLinkUrl: "https://buymeacoffee.com/example",
      donationQrImageUrl: null
    };
    tickets.seedTicket({
      id: "ticket-donation",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "donation-ticket-channel",
      optionId: "donation-option-1",
      status: "open",
      originalCategoryId: "donate-category",
      claimedBy: null,
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });

    const confirmResult = await service.confirmDonationIntentByTicketId("ticket-donation", {
      actorId: "user-1",
      actorRoleIds: [],
      hasManageChannels: false
    });

    expect(confirmResult.ok).toBe(true);
    expect(gateway.donationIntentUpdates).toEqual([
      {
        channelId: "donation-ticket-channel",
        ticketId: "ticket-donation"
      }
    ]);

    await service.handleIncomingTicketMessage({
      channelId: "donation-ticket-channel",
      authorId: "user-1",
      attachments: [
        {
          name: "proof.png",
          url: "https://example.com/donate-proof.png",
          contentType: "image/png"
        }
      ]
    });

    expect(gateway.channelMessages.at(-1)?.content).toContain("<@&donation-staff>");

    const approveResult = await service.approveDonationByChannel("donation-ticket-channel", {
      actorId: "admin-1",
      actorRoleIds: [],
      hasManageChannels: true
    });

    expect(approveResult.ok).toBe(true);
    expect(gateway.grantedRoles).toEqual([
      {
        guildId: "guild-1",
        userId: "user-1",
        roleId: "donator-role"
      }
    ]);
    expect(gateway.donationThanksMessages).toEqual([
      {
        guildId: "guild-1",
        thanksChannelId: "thanks-channel",
        userId: "user-1"
      }
    ]);
    expect(gateway.donationApprovalUpdates).toEqual([
      {
        channelId: "donation-ticket-channel",
        ticketId: "ticket-donation",
        approvedBy: "admin-1"
      }
    ]);
  });

  it("lets the requester trigger activation after verification succeeds", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: "staff-1",
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "staff-1",
      eventType: "ticket.claimed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.screenshot_validation_passed",
      payload: {}
    });

    const result = await service.activateByTicketId("ticket-steam", {
      actorId: "user-1",
      actorRoleIds: [],
      hasManageChannels: false
    });

    expect(result.ok).toBe(true);
    expect(gateway.verificationActivations).toEqual([
      {
        channelId: "steam-ticket-channel",
        ticketId: "ticket-steam",
        activatedBy: "user-1"
      }
    ]);
  });

  it("lets admin send the activation token panel inside a steam ticket", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: "staff-1",
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "staff-1",
      eventType: "ticket.claimed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.screenshot_validation_passed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.activation_requested",
      payload: {}
    });

    const result = await service.sendActivationTokenByChannel(
      "steam-ticket-channel",
      {
        actorId: "admin-1",
        actorRoleIds: [],
        hasManageChannels: true
      },
      {
        name: "token.zip",
        url: "https://example.com/token.zip",
        linkUrl: null
      }
    );

    expect(result.ok).toBe(true);
    expect(gateway.activationTokenPanels).toEqual([
      {
        channelId: "steam-ticket-channel",
        ticketId: "ticket-steam",
        fileName: "token.zip",
        fileUrl: "https://example.com/token.zip",
        linkUrl: null,
        tokenExpiresAt: expect.any(Date)
      }
    ]);
  });

  it("lets admin send a token link without uploading a file", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: "staff-1",
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "staff-1",
      eventType: "ticket.claimed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.screenshot_validation_passed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.activation_requested",
      payload: {}
    });

    const result = await service.sendActivationTokenByChannel(
      "steam-ticket-channel",
      {
        actorId: "admin-1",
        actorRoleIds: [],
        hasManageChannels: true
      },
      {
        name: null,
        url: null,
        linkUrl: "https://example.com/token"
      }
    );

    expect(result.ok).toBe(true);
    expect(gateway.activationTokenPanels[0]?.linkUrl).toBe("https://example.com/token");
    expect(gateway.activationTokenPanels[0]?.fileUrl).toBeNull();
  });

  it("lets the requester confirm the token and schedules auto close", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: "staff-1",
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "staff-1",
      eventType: "ticket.claimed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.screenshot_validation_passed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.activation_requested",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "admin-1",
      eventType: "ticket.activation_token_sent",
      payload: {}
    });

    const result = await service.confirmTokenDownloadedByTicketId("ticket-steam", {
      actorId: "user-1",
      actorRoleIds: [],
      hasManageChannels: false
    });

    expect(result.ok).toBe(true);
    expect(gateway.activationTokenConfirmations).toEqual([
      {
        channelId: "steam-ticket-channel",
        ticketId: "ticket-steam",
        activatedBy: "user-1",
        autoCloseAt: expect.any(Date)
      }
    ]);
  });

  it("submits a support reason and tags the claimed staff member", async () => {
    tickets.seedTicket({
      id: "ticket-steam",
      guildId: "guild-1",
      userId: "user-1",
      channelId: "steam-ticket-channel",
      optionId: "steam-option-1",
      status: "open",
      originalCategoryId: "steam-category",
      claimedBy: "staff-1",
      closedBy: null,
      closedAt: null,
      transcriptMessageId: null
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "staff-1",
      eventType: "ticket.claimed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.screenshot_validation_passed",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "user-1",
      eventType: "ticket.activation_requested",
      payload: {}
    });
    await tickets.addEvent({
      ticketId: "ticket-steam",
      actorId: "admin-1",
      eventType: "ticket.activation_token_sent",
      payload: {}
    });

    const result = await service.submitTokenSupportByTicketId(
      "ticket-steam",
      {
        actorId: "user-1",
        actorRoleIds: [],
        hasManageChannels: false
      },
      "Game không mở sau khi dán token."
    );

    expect(result.ok).toBe(true);
    expect(gateway.channelMessages.at(-1)?.content).toContain("<@staff-1>");
    expect(gateway.channelMessages.at(-1)?.content).toContain("Game không mở");
  });
});
