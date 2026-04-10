export interface TicketIssueOption {
  value: string;
  label: string;
  description: string;
}

export const ticketIssueCatalog: TicketIssueOption[] = [
  {
    value: "activation-help",
    label: "Cần kích hoạt game",
    description: "Bạn cần staff hỗ trợ kích hoạt sản phẩm."
  },
  {
    value: "account-problem",
    label: "Lỗi account",
    description: "Bạn đang bị lỗi tài khoản, mail hoặc bảo mật."
  },
  {
    value: "verification-problem",
    label: "Lỗi verify / check",
    description: "Bạn cần kiểm tra đơn, key hoặc trạng thái game."
  },
  {
    value: "extra-info",
    label: "Bổ sung thông tin",
    description: "Bạn muốn gửi thêm thông tin để staff xử lý nhanh hơn."
  },
  {
    value: "other",
    label: "Khác",
    description: "Vấn đề của bạn không nằm trong các mục phía trên."
  }
];

export function getTicketIssueByValue(value: string): TicketIssueOption | null {
  return ticketIssueCatalog.find((item) => item.value === value) ?? null;
}
