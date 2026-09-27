import { describe, expect, it, vi } from "vitest";
import { ensureScheduledEmailJob } from "../src/scheduling";

describe("email scheduling", () => {
  it("creates a deterministic BullMQ job and returns its persisted ID", async () => {
    const queue = {
      getJob: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue({ id: "email-email-1", remove: vi.fn() }),
    };
    const email = {
      id: "email-1",
      scheduledAt: new Date("2026-09-27T10:00:00.000Z"),
      bullJobId: null,
    };

    const result = await ensureScheduledEmailJob({
      email,
      queue,
      now: Date.parse("2026-09-27T09:00:00.000Z"),
    });

    expect(result.jobId).toBe("email-email-1");
    expect(result.created).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      "email-email-1",
      { emailId: "email-1" },
      expect.objectContaining({ jobId: "email-email-1", delay: 3600000 }),
    );
  });

  it("reuses an existing deterministic job", async () => {
    const existingJob = { id: "email-email-1", remove: vi.fn() };
    const queue = {
      getJob: vi.fn().mockResolvedValue(existingJob),
      add: vi.fn(),
    };

    const result = await ensureScheduledEmailJob({
      email: { id: "email-1", scheduledAt: new Date(), bullJobId: null },
      queue,
    });

    expect(result).toEqual({ job: existingJob, jobId: "email-email-1", created: false });
    expect(queue.add).not.toHaveBeenCalled();
  });
});