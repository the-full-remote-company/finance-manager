import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Article IV, mechanically: "any violation at serious or critical severity
 * fails the build". SC-007 states zero violations at those severities on every
 * screen in this feature.
 *
 * Deliberately NOT parameterised with a disable list. A rule that a screen
 * cannot satisfy is a defect in the screen, and Article IX forbids weakening a
 * gate to make a build pass. If an exception is ever genuinely required it
 * belongs in an ADR, not in a call site.
 */
export async function expectNoSeriousA11yViolations(page: Page, context?: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    blocking,
    [
      `Accessibility violations at serious or critical severity${context ? ` on ${context}` : ""}:`,
      ...blocking.map(
        (violation) =>
          `  [${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}\n` +
          violation.nodes.map((node) => `      ${node.target.join(" ")}`).join("\n"),
      ),
    ].join("\n"),
  ).toEqual([]);
}

/**
 * WCAG 2.2 SC 2.5.8: every interactive target clears 44x44 CSS pixels. axe does
 * not check target size, so it is asserted separately rather than assumed from
 * the design system's --touch-min token.
 */
export async function expectTouchTargets(
  page: Page,
  selector = "a, button, [role='button'], input, select",
): Promise<void> {
  const targets = await page.locator(selector).all();
  for (const target of targets) {
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (!box) continue;
    expect
      .soft(
        Math.min(box.width, box.height),
        `interactive target smaller than 44 CSS px (WCAG 2.2 SC 2.5.8): ${await target.evaluate((el) => el.outerHTML.slice(0, 120))}`,
      )
      .toBeGreaterThanOrEqual(44);
  }
}
