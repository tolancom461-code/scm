export const REQUEST_STATUSES = ["draft", "submitted", "approved", "rejected", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const transitions: Record<RequestStatus, RequestStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["approved", "rejected", "cancelled"],
  approved: ["cancelled"],
  rejected: ["draft", "cancelled"],
  cancelled: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus) {
  return transitions[from].includes(to);
}
