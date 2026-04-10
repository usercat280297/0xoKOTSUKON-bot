export const ComponentIds = {
  panelSelect: (panelId: string) => `ticket-panel:${panelId}`,
  claimButton: (ticketId: string) => `ticket:claim:${ticketId}`,
  closeButton: (ticketId: string) => `ticket:close:${ticketId}`
};

export function parsePanelSelectId(customId: string): string | null {
  const [prefix, panelId] = customId.split(":");
  if (prefix !== "ticket-panel" || !panelId) {
    return null;
  }

  return panelId;
}

export function parseTicketButton(customId: string): { action: "claim" | "close"; ticketId: string } | null {
  const [namespace, action, ticketId] = customId.split(":");
  if (namespace !== "ticket" || !ticketId) {
    return null;
  }

  if (action !== "claim" && action !== "close") {
    return null;
  }

  return { action, ticketId };
}
