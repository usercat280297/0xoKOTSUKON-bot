export const ComponentIds = {
  panelSelect: (panelId: string, scope?: string) => `ticket-panel:${panelId}${scope ? `:${scope}` : ""}`,
  panelReset: (panelId: string) => `ticket-panel-reset:${panelId}`,
  donationPanelOpen: (panelId: string, optionValue: string) => `ticket-donation-panel:${panelId}:${optionValue}`,
  selfRoleButton: (roleId: string) => `self-role:${roleId}`,
  dailyCheckinButton: () => "daily-checkin:checkin",
  issueSelect: (ticketId: string) => `ticket-issue:${ticketId}`,
  claimButton: (ticketId: string) => `ticket:claim:${ticketId}`,
  activationButton: (ticketId: string) => `ticket:activate:${ticketId}`,
  closeButton: (ticketId: string) => `ticket:close:${ticketId}`,
  donationConfirmButton: (ticketId: string) => `ticket-donation:confirm:${ticketId}`,
  tokenActivatedButton: (ticketId: string) => `ticket-token:activated:${ticketId}`,
  tokenSupportButton: (ticketId: string) => `ticket-token:support:${ticketId}`,
  tokenSupportModal: (ticketId: string) => `ticket-token-support:${ticketId}`
};

export function parsePanelSelectId(customId: string): string | null {
  const [prefix, panelId] = customId.split(":");
  if (prefix !== "ticket-panel" || !panelId) {
    return null;
  }

  return panelId;
}

export function parseTicketButton(customId: string): { action: "claim" | "close" | "activate"; ticketId: string } | null {
  const [namespace, action, ticketId] = customId.split(":");
  if (namespace !== "ticket" || !ticketId) {
    return null;
  }

  if (action !== "claim" && action !== "close" && action !== "activate") {
    return null;
  }

  return { action, ticketId };
}

export function parseDonationPanelButtonId(customId: string): { panelId: string; optionValue: string } | null {
  const [namespace, panelId, optionValue] = customId.split(":");
  if (namespace !== "ticket-donation-panel" || !panelId || !optionValue) {
    return null;
  }

  return { panelId, optionValue };
}

export function parseSelfRoleButtonId(customId: string): { roleId: string } | null {
  const [namespace, roleId] = customId.split(":");
  if (namespace !== "self-role" || !roleId) {
    return null;
  }

  return { roleId };
}

export function parseDailyCheckinButtonId(customId: string): { action: "checkin" } | null {
  const [namespace, action] = customId.split(":");
  if (namespace !== "daily-checkin" || action !== "checkin") {
    return null;
  }

  return { action: "checkin" };
}

export function parseDonationTicketButton(
  customId: string
): { action: "confirm"; ticketId: string } | null {
  const [namespace, action, ticketId] = customId.split(":");
  if (namespace !== "ticket-donation" || !ticketId) {
    return null;
  }

  if (action !== "confirm") {
    return null;
  }

  return { action, ticketId };
}

export function parseTokenButton(customId: string): { action: "activated" | "support"; ticketId: string } | null {
  const [namespace, action, ticketId] = customId.split(":");
  if (namespace !== "ticket-token" || !ticketId) {
    return null;
  }

  if (action !== "activated" && action !== "support") {
    return null;
  }

  return { action, ticketId };
}

export function parsePanelResetId(customId: string): string | null {
  const [prefix, panelId] = customId.split(":");
  if (prefix !== "ticket-panel-reset" || !panelId) {
    return null;
  }

  return panelId;
}

export function parseTicketIssueSelectId(customId: string): string | null {
  const [prefix, ticketId] = customId.split(":");
  if (prefix !== "ticket-issue" || !ticketId) {
    return null;
  }

  return ticketId;
}

export function parseTokenSupportModalId(customId: string): string | null {
  const [prefix, ticketId] = customId.split(":");
  if (prefix !== "ticket-token-support" || !ticketId) {
    return null;
  }

  return ticketId;
}
