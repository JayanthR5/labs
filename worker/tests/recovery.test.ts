import { describe, expect, it, vi } from "vitest";
import { ensureScheduledEmailJob, recoverMissingScheduledJobs } from "../src/recovery";

const email = (overrides = {}) => ({
  id: "email-1",
  scheduledAt: new Date("2026-09-27T10:00:00.000Z"),
  bullJobId: null,
  status: "scheduled",
  ...overrides,
});

describe("scheduled email job recovery", () => {
  it("does not create a duplicate when the email already has a job ID", async () => {
    const queue = { getJob: vi.fn(), add: vi.fn() };
    const emailStore = { update: vi.fn() };
    const result = await ensureScheduledEmailJob({ email: email({ bullJobId: "email:email-1" }), queue, emailStore, now: Date.parse("2026-09-26T10:00:00.000Z") });
    expect(result).toBe("skipped");
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("reuses an existing deterministic BullMQ job", async () => {
    const queue = { getJob: vi.fn().mockResolvedValue({ id: "email:email-1" }), add: vi.fn() };
    const emailStore = { update: vi.fn() };
    const result = await ensureScheduledEmailJob({ email: email(), queue, emailStore, now: Date.parse("2026-09-26T10:00:00.000Z") });
    expect(result).toBe("reused");
    expect(queue.add).not.toHaveBeenCalled();
    expect(emailStore.update).toHaveBeenCalledWith({ where: { id: "email-1" }, data: { bullJobId: "email:email-1" } });
  });

  it("creates and persists a missing future job", async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined), add: vi.fn().mockResolvedValue({ id: "email:email-1" }) };
    const emailStore = { update: vi.fn() };
    const result = await ensureScheduledEmailJob({ email: email(), queue, emailStore, now: Date.parse("2026-09-26T10:00:00.000Z") });
    expect(result).toBe("created");
    expect(queue.add).toHaveBeenCalledWith("email:email-1", { emailId: "email-1" }, expect.objectContaining({ jobId: "email:email-1", delay: 86400000 }));
    expect(emailStore.update).toHaveBeenCalledWith({ where: { id: "email-1" }, data: { bullJobId: "email:email-1" } });
  });

  it("does not automatically recover a past-due email", async () => {
    const queue = { getJob: vi.fn(), add: vi.fn() };
    const emailStore = { update: vi.fn() };
    const result = await ensureScheduledEmailJob({ email: email({ scheduledAt: new Date("2026-09-25T10:00:00.000Z") }), queue, emailStore, now: Date.parse("2026-09-26T10:00:00.000Z") });
    expect(result).toBe("skipped");
    expect(queue.getJob).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("queries only future scheduled emails missing jobs", async () => {
    const emailStore = { findMany: vi.fn().mockResolvedValue([]) };
    const logger = { info: vi.fn() };
    await recoverMissingScheduledJobs({ queue: { getJob: vi.fn(), add: vi.fn() }, emailStore, logger, now: Date.parse("2026-09-26T10:00:00.000Z") });
    expect(emailStore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "scheduled", bullJobId: null, scheduledAt: { gte: new Date("2026-09-26T10:00:00.000Z") } } }));
  });
});
