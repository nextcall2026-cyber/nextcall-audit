import { describe, it, expect, vi } from "vitest";
import {
  buildSendPlan,
  parseFromAddress,
  totalRemaining,
  ProviderCapacity,
} from "@/lib/emailRouting";
import { EmailService } from "@/services/emailService";
import { IEmailProvider, QuotaGateway, SendEmailOutput } from "@/services/emailProvider";
import { EmailProviderName } from "@/types";

function capacity(
  name: EmailProviderName,
  used: number,
  limit: number,
  configured = true
): ProviderCapacity {
  return { name, configured, used, limit, remaining: Math.max(0, limit - used) };
}

function fakeProvider(name: EmailProviderName, result: SendEmailOutput): IEmailProvider {
  return {
    name,
    isConfigured: () => true,
    send: vi.fn(async () => result),
  };
}

interface FakeQuota extends QuotaGateway {
  recorded: EmailProviderName[];
  exhausted: EmailProviderName[];
}

function fakeQuota(plan: EmailProviderName[], capacities: ProviderCapacity[]): FakeQuota {
  const recorded: EmailProviderName[] = [];
  const exhausted: EmailProviderName[] = [];

  return {
    recorded,
    exhausted,
    getSendPlan: async () => plan,
    getCapacities: async () => capacities,
    record: async (name) => {
      recorded.push(name);
    },
    markExhausted: async (name) => {
      exhausted.push(name);
    },
  };
}

const input = {
  to: "owner@example.com",
  subject: "Your audit",
  html: "<p>hi</p>",
  idempotencyKey: "prospect_1_stage_0",
};

describe("buildSendPlan", () => {
  it("offers Mailgun first while it has room, then Mailtop, then Resend", () => {
    const plan = buildSendPlan([
      capacity("mailgun", 0, 100),
      capacity("mailtop", 0, 150),
      capacity("resend", 0, 50),
    ]);
    expect(plan).toEqual(["mailgun", "mailtop", "resend"]);
  });

  it("drops Mailgun once its daily allowance is spent", () => {
    const plan = buildSendPlan([
      capacity("mailgun", 100, 100),
      capacity("mailtop", 12, 150),
      capacity("resend", 0, 50),
    ]);
    expect(plan).toEqual(["mailtop", "resend"]);
  });

  it("drops a provider that is not configured", () => {
    const plan = buildSendPlan([
      capacity("mailgun", 0, 100, false),
      capacity("mailtop", 0, 150),
      capacity("resend", 0, 50),
    ]);
    expect(plan).toEqual(["mailtop", "resend"]);
  });

  it("is empty when every provider is out of quota", () => {
    const plan = buildSendPlan([
      capacity("mailgun", 100, 100),
      capacity("mailtop", 150, 150),
      capacity("resend", 50, 50),
    ]);
    expect(plan).toEqual([]);
  });

  it("counts the whole day's remaining capacity across all three providers", () => {
    const remaining = totalRemaining([
      capacity("mailgun", 40, 100),
      capacity("mailtop", 150, 150),
      capacity("resend", 10, 50),
    ]);
    expect(remaining).toBe(100);
  });
});

describe("parseFromAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseFromAddress("NextCall <audit@getnextcall.com>")).toEqual({
      email: "audit@getnextcall.com",
      name: "NextCall",
    });
  });

  it("accepts a bare address", () => {
    expect(parseFromAddress("audit@getnextcall.com")).toEqual({ email: "audit@getnextcall.com" });
  });
});

describe("EmailService routing", () => {
  it("sends through Mailgun when it still has room", async () => {
    const mailgun = fakeProvider("mailgun", {
      success: true,
      providerMessageId: "mailgun-1",
      provider: "mailgun",
      error: null,
    });
    const mailtop = fakeProvider("mailtop", {
      success: true,
      providerMessageId: "mailtop-1",
      provider: "mailtop",
      error: null,
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-1",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(
      ["mailgun", "mailtop", "resend"],
      [capacity("mailgun", 0, 100), capacity("mailtop", 0, 150), capacity("resend", 0, 50)]
    );

    const service = new EmailService({ mailgun, mailtop, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mailgun");
    expect(mailgun.send).toHaveBeenCalledTimes(1);
    expect(mailtop.send).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
    expect(quota.recorded).toEqual(["mailgun"]);
  });

  it("falls through to Mailtop when Mailgun answers 'quota reached'", async () => {
    const mailgun = fakeProvider("mailgun", {
      success: false,
      providerMessageId: null,
      provider: "mailgun",
      error: "Mailgun: daily sending limit exceeded",
      errorKind: "quota",
    });
    const mailtop = fakeProvider("mailtop", {
      success: true,
      providerMessageId: "mailtop-9",
      provider: "mailtop",
      error: null,
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-9",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(
      ["mailgun", "mailtop", "resend"],
      [capacity("mailgun", 0, 100), capacity("mailtop", 0, 150), capacity("resend", 0, 50)]
    );

    const service = new EmailService({ mailgun, mailtop, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mailtop");
    expect(quota.exhausted).toEqual(["mailgun"]);
    expect(quota.recorded).toEqual(["mailtop"]);
  });

  it("reaches Resend only after Mailgun and Mailtop are both spent", async () => {
    const mailgun = fakeProvider("mailgun", {
      success: false,
      providerMessageId: null,
      provider: "mailgun",
      error: "Mailgun: daily sending limit exceeded",
      errorKind: "quota",
    });
    const mailtop = fakeProvider("mailtop", {
      success: false,
      providerMessageId: null,
      provider: "mailtop",
      error: "Mailtop: daily limit exceeded",
      errorKind: "quota",
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-9",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(
      ["mailgun", "mailtop", "resend"],
      [capacity("mailgun", 0, 100), capacity("mailtop", 0, 150), capacity("resend", 0, 50)]
    );

    const service = new EmailService({ mailgun, mailtop, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("resend");
    expect(quota.exhausted).toEqual(["mailgun", "mailtop"]);
    expect(quota.recorded).toEqual(["resend"]);
  });

  it("does not retry on the other providers after a transient failure", async () => {
    const mailgun = fakeProvider("mailgun", {
      success: false,
      providerMessageId: null,
      provider: "mailgun",
      error: "Mailgun: timeout",
      errorKind: "transient",
    });
    const mailtop = fakeProvider("mailtop", {
      success: true,
      providerMessageId: "mailtop-9",
      provider: "mailtop",
      error: null,
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-9",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(
      ["mailgun", "mailtop", "resend"],
      [capacity("mailgun", 0, 100), capacity("mailtop", 0, 150), capacity("resend", 0, 50)]
    );

    const service = new EmailService({ mailgun, mailtop, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("transient");
    expect(mailtop.send).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("reports the quotas when all three providers are spent", async () => {
    const quota = fakeQuota(
      [],
      [capacity("mailgun", 100, 100), capacity("mailtop", 150, 150), capacity("resend", 50, 50)]
    );
    const service = new EmailService(
      {
        mailgun: fakeProvider("mailgun", { success: false, providerMessageId: null, provider: "mailgun", error: "x" }),
        mailtop: fakeProvider("mailtop", { success: false, providerMessageId: null, provider: "mailtop", error: "x" }),
        resend: fakeProvider("resend", { success: false, providerMessageId: null, provider: "resend", error: "x" }),
      },
      quota
    );

    const result = await service.send(input);

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("quota");
    expect(result.error).toContain("quota");
    expect(result.error).toContain("Mailgun 100/100");
    expect(result.error).toContain("Mailtop (Mailtrap) 150/150");
    expect(result.error).toContain("Resend 50/50");
  });
});
