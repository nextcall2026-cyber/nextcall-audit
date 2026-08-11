import { describe, it, expect } from "vitest";
import { parseBusinessNotes } from "../notesParser";

describe("parseBusinessNotes", () => {
  it("extracts social profiles with platform and normalized URL", () => {
    const parsed = parseBusinessNotes(
      "Instagram: instagram.com/jlplumbing, Facebook: https://facebook.com/jlplumbing, tiktok.com/@jlplumbing"
    );
    expect(parsed.socialProfiles.map((s) => s.platform)).toEqual([
      "instagram",
      "facebook",
      "tiktok",
    ]);
    expect(parsed.socialProfiles[1].url).toBe("https://facebook.com/jlplumbing");
    expect(parsed.socialProfiles[0].confidence).toBe(100);
  });

  it("detects booking platforms and their names", () => {
    const parsed = parseBusinessNotes("they book clients through calendly.com/jlplumbing");
    expect(parsed.booking?.detected).toBe(true);
    expect(parsed.booking?.systemName).toBe("Calendly");
    expect(parsed.booking?.url).toBe("https://calendly.com/jlplumbing");
  });

  it("detects booking from keyword plus appointment URL", () => {
    const parsed = parseBusinessNotes("bookings are taken at jlplumbing.com/appointments");
    expect(parsed.booking?.detected).toBe(true);
    expect(parsed.booking?.systemName).toBe("online booking");
  });

  it("does not claim booking when the note says there is none", () => {
    const parsed = parseBusinessNotes("no online booking, they only take calls");
    expect(parsed.booking).toBeNull();
  });

  it("extracts email and phone", () => {
    const parsed = parseBusinessNotes(
      "email: info@jlplumbing.com, call (512) 555-0123 or +1-555-333-4444"
    );
    expect(parsed.emails.map((e) => e.address)).toEqual(["info@jlplumbing.com"]);
    expect(parsed.phone).toMatch(/512/);
  });

  it("extracts a general website and never a social URL as the website", () => {
    const parsed = parseBusinessNotes(
      "website is jlplumbing.com and their instagram is instagram.com/jlplumbing"
    );
    expect(parsed.website).toBe("https://jlplumbing.com");
  });

  it("returns empty signals for empty notes", () => {
    const parsed = parseBusinessNotes("");
    expect(parsed.socialProfiles).toEqual([]);
    expect(parsed.booking).toBeNull();
    expect(parsed.emails).toEqual([]);
    expect(parsed.phone).toBeNull();
    expect(parsed.website).toBeNull();
  });
});