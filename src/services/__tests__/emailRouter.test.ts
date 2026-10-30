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
  it("offers Brevo first while it has room, then Resend", () => {
    const plan = buildSendPlan([capacity("brevo", 0, 300), capacity("resend", 0, 50)]);
    expect(plan).toEqual(["brevo", "resend"]);
  });

  it("drops Brevo once its daily allowance is spent", () => {
    const plan = buildSendPlan([capacity("brevo", 300, 300), capacity("resend", 12, 50)]);
    expect(plan).toEqual(["resend"]);
  });

  it("drops a provider that is not configured", () => {
    const plan = buildSendPlan([capacity("brevo", 0, 300, false), capacity("resend", 0, 50)]);
    expect(plan).toEqual(["resend"]);
  });

  it("is empty when every provider is out of quota", () => {
    const plan = buildSendPlan([capacity("brevo", 300, 300), capacity("resend", 50, 50)]);
    expect(plan).toEqual([]);
  });

  it("counts the whole day's remaining capacity across both providers", () => {
    const remaining = totalRemaining([capacity("brevo", 120, 300), capacity("resend", 10, 50)]);
    expect(remaining).toBe(220);
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
  it("sends through Brevo when it still has room", async () => {
    const brevo = fakeProvider("brevo", {
      success: true,
      providerMessageId: "brevo-1",
      provider: "brevo",
      error: null,
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-1",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(["brevo", "resend"], [capacity("brevo", 0, 300), capacity("resend", 0, 50)]);

    const service = new EmailService({ brevo, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("brevo");
    expect(brevo.send).toHaveBeenCalledTimes(1);
    expect(resend.send).not.toHaveBeenCalled();
    expect(quota.recorded).toEqual(["brevo"]);
  });

  it("falls back to Resend when Brevo answers 'quota reached'", async () => {
    const brevo = fakeProvider("brevo", {
      success: false,
      providerMessageId: null,
      provider: "brevo",
      error: "Brevo: daily quota exceeded",
      errorKind: "quota",
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-9",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(["brevo", "resend"], [capacity("brevo", 0, 300), capacity("resend", 0, 50)]);

    const service = new EmailService({ brevo, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("resend");
    expect(quota.exhausted).toEqual(["brevo"]);
    expect(quota.recorded).toEqual(["resend"]);
  });

  it("does not retry on the other provider after a transient failure", async () => {
    const brevo = fakeProvider("brevo", {
      success: false,
      providerMessageId: null,
      provider: "brevo",
      error: "Brevo: timeout",
      errorKind: "transient",
    });
    const resend = fakeProvider("resend", {
      success: true,
      providerMessageId: "resend-9",
      provider: "resend",
      error: null,
    });
    const quota = fakeQuota(["brevo", "resend"], [capacity("brevo", 0, 300), capacity("resend", 0, 50)]);

    const service = new EmailService({ brevo, resend }, quota);
    const result = await service.send(input);

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("transient");
    expect(resend.send).not.toHaveBeenCalled();
  });

  it("reports the quotas when both providers are spent", async () => {
    const quota = fakeQuota([], [capacity("brevo", 300, 300), capacity("resend", 50, 50)]);
    const service = new EmailService(
      {
        brevo: fakeProvider("brevo", { success: false, providerMessageId: null, provider: "brevo", error: "x" }),
        resend: fakeProvider("resend", { success: false, providerMessageId: null, provider: "resend", error: "x" }),
      },
      quota
    );

    const result = await service.send(input);

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("quota");
    expect(result.error).toContain("quota");
    expect(result.error).toContain("Brevo 300/300");
    expect(result.error).toContain("Resend 50/50");
  });
});
