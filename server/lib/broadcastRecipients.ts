/**
 * Pure, dependency-injected functions that compute the set of WebSocket
 * recipient user IDs for each sensitive broadcast event type.
 *
 * Keeping the recipient logic here (rather than inlined in route handlers)
 * makes it trivially unit-testable without a database or Express context.
 * Route handlers pass `getUserIdsWithPermission` from permissionUtils as the
 * `getPermittedIds` callback; tests pass a vi.fn() mock.
 */

export type GetPermittedIds = (permName: string) => Promise<string[]>;

/**
 * Recipients for `time_entry_created` and `time_entry_updated` events.
 * Only the entry owner and users with the `time.view_all` permission should
 * receive these messages.
 */
export async function computeTimeEntryRecipients(
  ownerId: string,
  getPermittedIds: GetPermittedIds,
): Promise<string[]> {
  const timeViewerIds = await getPermittedIds("time.view_all");
  return Array.from(new Set([ownerId, ...timeViewerIds]));
}

/**
 * Recipients for `debrief_submitted` events.
 * Only the submitting employee and users with `hr.view_team` or
 * `admin.manage_all` should receive these messages.
 */
export async function computeDebriefRecipients(
  submitterId: string,
  getPermittedIds: GetPermittedIds,
): Promise<string[]> {
  const [managerIds, adminIds] = await Promise.all([
    getPermittedIds("hr.view_team"),
    getPermittedIds("admin.manage_all"),
  ]);
  return Array.from(new Set([submitterId, ...managerIds, ...adminIds]));
}

/**
 * Recipients for GTD inbox events (`inbox_item_created`, `inbox_item_processed`).
 * Only the user who captured the item should receive these messages.
 */
export function computeGtdInboxRecipients(capturedByUserId: string): string[] {
  return [capturedByUserId];
}

/**
 * Recipients for GTD action events (`action_created`, `action_completed`).
 * Only the actor (current user), the assignee, and the original creator
 * should receive these messages.
 */
export function computeGtdActionRecipients(
  actorId: string,
  assignedTo: string | null | undefined,
  createdBy?: string | null,
): string[] {
  return Array.from(
    new Set(
      [actorId, assignedTo, createdBy].filter((id): id is string => Boolean(id)),
    ),
  );
}

/**
 * Recipients for the `new_message` DM event sent by `POST /api/schedules/notify-week`.
 * Only the admin who triggered the send and the target employee should receive
 * the week-schedule DM.
 */
export function computeScheduleDmRecipients(
  adminId: string,
  employeeId: string,
): string[] {
  return [adminId, employeeId];
}
