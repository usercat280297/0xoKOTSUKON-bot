export const ComponentIds = {
  panelSelect: (panelId: string, scope?: string) => `ticket-panel:${panelId}${scope ? `:${scope}` : ""}`,
  panelReset: (panelId: string) => `ticket-panel-reset:${panelId}`,
  issueSelect: (ticketId: string) => `ticket-issue:${ticketId}`,
  claimButton: (ticketId: string) => `ticket:claim:${ticketId}`,
  activationButton: (ticketId: string) => `ticket:activate:${ticketId}`,
  closeButton: (ticketId: string) => `ticket:close:${ticketId}`,
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
