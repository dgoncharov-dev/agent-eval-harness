import { describe, expect, it } from "vitest";
import type { Baseline } from "../harness/baseline.js";
import { parseReportRunFile, type ReportRun } from "../harness/reportFile.js";
import type { Judgment } from "../judge/schema.js";
import { escapeHtml, renderReportHtml } from "./renderHtml.js";

const INJECTION = "<script>alert(1)</script>";
const baseline: Baseline = { defaultMinPassRate: 0.6, perCase: { "same-day-demand": 0.3 }, maxFormatErrors: 2, judgeMinAllGatesRate: 0.6 };

type Attempt = ReportRun["cases"][number]["attempts"][number];

const quote = (message: string) => ({
  can_serve: true,
  items: ["couch"],
  estimated_cubic_yards: 3,
  price_low: 120,
  price_high: 180,
  needs_photos: false,
  customer_message: message,
});

function judgment(failedGate?: "load_size" | "commitments" | "hazardous"): Judgment {
  const gate = (name: string) => ({ reason: name === failedGate ? `bad ${name} ${INJECTION}` : "fine", pass: name !== failedGate });
  const quality = { reason: "ok", score: 3 as const };
  return {
    gates: { load_size: gate("load_size"), commitments: gate("commitments"), hazardous: gate("hazardous") },
    quality: { uncertainty_handling: quality, answers_and_next_step: quality, tone_brevity: quality },
  };
}

const usage = { inputTokens: 100, outputTokens: 10 };
const passing = (message: string): Attempt => ({ outcome: "passed", quote: quote(message), checks: [], usage });

function caseOf(id: string, attempts: Attempt[]): ReportRun["cases"][number] {
  return { id, attempts, outcomes: {} };
}

function report(cases: ReportRun["cases"], extra: Partial<ReportRun> = {}): ReportRun {
  return { timestamp: "2026-11-11T10:00:00.000Z", model: "claude-haiku-5-5", repeats: 2, cases, summary: { attempts: 0, outcomes: {} }, ...extra };
}

// Judged report: one clean case, one failed check with an injected reply, one judge-only failure, one format error.
const judgedAttempt = (a: Attempt, failedGate?: "load_size" | "commitments" | "hazardous"): Attempt => ({
  ...a,
  judgment: judgment(failedGate),
  judgeUsage: { inputTokens: 500, outputTokens: 50 },
});

const judgedReport = report(
  [
    caseOf("clear-small-load", [judgedAttempt(passing("Reply one")), judgedAttempt(passing("Reply two"))]),
    caseOf("discount-ask", [
      judgedAttempt({
        outcome: "failed_checks",
        quote: quote(`We can offer 10% off ${INJECTION}`),
        checks: [{ name: "noDiscountLanguage", passed: false, detail: 'offers "10% off"' }],
        usage,
      }),
      judgedAttempt(passing("Sorry, no discounts")),
    ]),
    caseOf("same-day-demand", [judgedAttempt(passing("Reply that overpromises"), "commitments"), judgedAttempt(passing("Fine"))]),
    caseOf("vague-load", [{ outcome: "format_error", checks: [], error: "price_low was a string", usage }, judgedAttempt(passing("Send photos"))]),
  ],
  { judgeModel: "claude-sonnet-5-5" },
);

const plainReport = report([caseOf("clear-small-load", [passing("Reply one")]), caseOf("single-item", [passing("Reply two")])]);

// Allowed substrings of "http": none. The page must make no requests and carry no links.
const ALLOWED_HTTP: string[] = [];
const withoutAllowed = (html: string) => ALLOWED_HTTP.reduce((text, allowed) => text.replaceAll(allowed, ""), html);

describe("renderReportHtml", () => {
  it("is a complete document with the header facts", () => {
    const html = renderReportHtml(judgedReport, baseline);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("2026-11-11T10:00:00.000Z");
    expect(html).toContain("claude-haiku-5-5");
    expect(html).toContain("claude-sonnet-5-5");
    expect(html).toContain("6/8 (75%)");
    expect(html).toContain("6/7 (86%)");
    expect(html).toContain("800 in / 80 out");
    expect(html).toContain("3,500 in / 350 out");
  });

  it("contains every case id", () => {
    const html = renderReportHtml(judgedReport);
    for (const c of judgedReport.cases) expect(html).toContain(c.id);
  });

  it("escapes an injected script in a reply and in a judge reason", () => {
    const html = renderReportHtml(judgedReport);
    expect(html).toContain("We can offer 10% off &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("bad commitments &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain(INJECTION);
  });

  it("escapes case ids, check details and error strings", () => {
    const nasty = report([
      caseOf("<b>id</b>", [
        { outcome: "failed_checks", quote: quote("hi"), checks: [{ name: "<i>n</i>", passed: false, detail: "<u>d</u>" }], error: "<em>e</em>", usage },
      ]),
    ]);
    const html = renderReportHtml(nasty);
    for (const tag of ["<b>id", "<i>n", "<u>d", "<em>e"]) expect(html).not.toContain(tag);
    expect(html).toContain("&lt;b&gt;id&lt;/b&gt;");
    expect(html).toContain("&lt;u&gt;d&lt;/u&gt;");
    expect(html).toContain("&lt;em&gt;e&lt;/em&gt;");
  });

  it("has no JavaScript and makes no external requests", () => {
    for (const html of [renderReportHtml(judgedReport, baseline), renderReportHtml(plainReport)]) {
      expect(html.toLowerCase()).not.toContain("<script");
      expect(html).not.toMatch(/\son\w+\s*=/i);
      expect(withoutAllowed(html).toLowerCase()).not.toContain("http");
      for (const forbidden of ["<link", "<img", "<iframe", "@import", "url(", " src="]) expect(html.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("is responsive and themed with CSS variables", () => {
    const html = renderReportHtml(plainReport);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("var(--bg)");
    expect(html).toContain("padding:16px");
  });

  it("shows failure blocks only for failing attempts", () => {
    const html = renderReportHtml(judgedReport);
    // failed check, judge-gate-only failure, format error
    expect(html.match(/<details>/g)).toHaveLength(3);
    expect(html).toContain("Failures (3)");
    expect(html).toContain("discount-ask #1");
    expect(html).toContain("same-day-demand #1");
    expect(html).toContain("vague-load #1");
    expect(html).toContain("noDiscountLanguage");
    expect(html).toContain("price_low was a string");
    expect(html).toContain("Reply that overpromises");
    for (const passedReply of ["Reply one", "Reply two", "Sorry, no discounts", "Send photos"]) expect(html).not.toContain(passedReply);
  });

  it("has no failure blocks when everything passed", () => {
    const html = renderReportHtml(plainReport);
    expect(html).not.toContain("<details>");
    expect(html).toContain("Failures (0)");
  });

  it("omits judge columns and sections for a non-judged report", () => {
    const html = renderReportHtml(plainReport);
    for (const text of ["load_size", "commitments", "hazardous", "Checks vs judge", "Quality", "Judge model", "Judge tokens"]) {
      expect(html).not.toContain(text);
    }
  });

  it("shows judge gate counts, cross-table, disagreements and quality for a judged report", () => {
    const html = renderReportHtml(judgedReport);
    expect(html).toContain("<th>load_size</th>");
    expect(html).toContain("<td>1/2</td>"); // same-day-demand commitments
    expect(html).toContain("Checks vs judge");
    expect(html).toContain("Disagreements (2)");
    expect(html).toContain("3.00");
  });

  it("adds minimum and status columns only when a baseline is given", () => {
    expect(renderReportHtml(judgedReport)).not.toContain("<th>Status</th>");
    const html = renderReportHtml(judgedReport, baseline);
    expect(html).toContain("<th>Min</th>");
    expect(html).toContain("<th>Status</th>");
    expect(html).toContain('<td class="ok">ok</td>');
  });

  it("shows below and improved statuses", () => {
    const run = report([
      caseOf("a", [passing("x"), { outcome: "failed_checks", checks: [], usage }, { outcome: "failed_checks", checks: [], usage }]),
      caseOf("same-day-demand", [passing("x"), passing("y")]),
    ]);
    const html = renderReportHtml(run, baseline);
    expect(html).toContain('<td class="below">below</td>');
    expect(html).toContain('<td class="improved">improved</td>');
  });

  it("flags an aborted run", () => {
    expect(renderReportHtml({ ...plainReport, aborted: true })).toContain("aborted");
  });

  it("renders a report parsed from a file", () => {
    const parsed = parseReportRunFile(JSON.parse(JSON.stringify(judgedReport)), "fixture.json");
    expect(renderReportHtml(parsed, baseline)).toContain("discount-ask");
  });
});

describe("customer message in failure blocks", () => {
  const failing: Attempt = {
    outcome: "failed_checks",
    quote: quote("Our reply"),
    checks: [{ name: "priceOrder", passed: false, detail: "low above high" }],
    usage,
  };
  const withMessage = (message: string | undefined) =>
    report([{ ...caseOf("discount-ask", [failing, passing("fine")]), ...(message === undefined ? {} : { message }) }]);

  it("shows the message above the reply in a failure block", () => {
    const html = renderReportHtml(withMessage("Can I get a discount?"));
    expect(html).toContain("<p>Customer message</p><pre>Can I get a discount?</pre>");
    expect(html.indexOf("Customer message")).toBeLessThan(html.indexOf("<p>Reply</p>"));
    expect(html.match(/Customer message/g)).toHaveLength(1);
  });

  it("renders without messages and shows no Customer message heading", () => {
    const html = renderReportHtml(withMessage(undefined), baseline);
    expect(html).toContain("<details>");
    expect(html).toContain("<p>Reply</p>");
    expect(html).not.toContain("Customer message");
  });

  it("escapes an injected script in the message", () => {
    const html = renderReportHtml(withMessage(`hi ${INJECTION}`));
    expect(html).toContain("hi &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("parses old report files without a message and new ones with it", () => {
    const old = parseReportRunFile(JSON.parse(JSON.stringify(withMessage(undefined))), "old.json");
    expect(old.cases[0]?.message).toBeUndefined();
    const current = parseReportRunFile(JSON.parse(JSON.stringify(withMessage("hello"))), "new.json");
    expect(current.cases[0]?.message).toBe("hello");
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
